require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const {
  createDashboardRouter,
  attachDashboardWebSocket,
} = require('./dashboard');
const dashboardEvents = require('./dashboardEvents');
const {
  ensureSessionSchema,
  listSessionAccounts,
  createSessionAccount,
  updateSessionIdentity,
  useDatabaseBackedAuthState,
  deleteSessionAccount,
} = require('./auth/multiSessionAuthState');
const { loadPlugins, handleMessage } = require('./lib/commandHandler');
const {
  isGroup,
  candidateIds,
  participantMatches,
  isAdmin,
  containsLink,
  userPart,
} = require('./lib/groupUtils');
const { getMute, setMute } = require('./lib/muteStore');
const { getEnabled: getAntiViewOnceEnabled } = require('./lib/antivvStore');
const { getSettings: getAntilinkSettings } = require('./lib/antilinkStore');
const { incrementStage, resetStage } = require('./lib/antilinkOffenseStore');
const { getViewOnceMedia, resendViewOnce } = require('./plugins/vv');

process.on('uncaughtException', (err) => console.error('🔥 Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('🔥 Unhandled Rejection:', reason));

const PREFIX = process.env.PREFIX || '.';
const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const USE_PAIRING_CODE = process.env.USE_PAIRING_CODE === 'true';
const PAIRING_COOLDOWN_MS = 60 * 1000;
const MAX_SESSIONS = Math.max(1, Number.parseInt(process.env.MAX_SESSIONS || '10', 10));
const DELETION_CODE_TTL_MS = 10 * 60 * 1000;
const DELETION_CODE_COOLDOWN_MS = 60 * 1000;

const DISOBEDIENCE_QUOTES = [
  'Discipline is choosing between what you want now and what you want most.',
  'Rules are not made to limit you, but to protect what you are part of.',
  'Those who ignore warnings often become the warning for others.',
  'The wise learn from correction; the foolish wait for consequence.',
  'Freedom without discipline eventually destroys itself.',
  'It is better to be corrected than to be removed.',
  'Every warning ignored is a step closer to the exit.',
  'Respect the space you are given, or lose the space entirely.',
  'The rules were kind. The outcome was a choice.',
];

const plugins = loadPlugins();
const sessions = new Map();
const startLocks = new Map();
const pairingRequests = new Map();
const deletionChallenges = new Map();
let latestBaileysVersion;

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function isOwnerMessage(msg, session) {
  if (msg.key?.fromMe) return true;
  const ownerNumber = normalizePhone(session.phoneNumber || phoneFromJid(session.waJid));
  if (!ownerNumber) return false;
  const senderJid = isGroup(msg.key?.remoteJid)
    ? (msg.key?.participantPn || msg.key?.participant)
    : (msg.key?.participantPn || msg.key?.remoteJid);
  return phoneFromJid(senderJid) === ownerNumber;
}

function phoneFromJid(jid) {
  const match = String(jid || '').match(/^(\d+)(?::\d+)?@/);
  return match ? match[1] : null;
}

function maskPhone(phoneNumber) {
  const value = normalizePhone(phoneNumber);
  if (value.length < 5) return value || null;
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(2, value.length - 5))}${value.slice(-2)}`;
}

function getOrCreateSession(account) {
  let session = sessions.get(account.account_id);
  if (!session) {
    session = {
      accountId: account.account_id,
      label: account.label,
      sock: null,
      connectionState: 'starting',
      isRegistered: null,
      phoneNumber: account.phone_number || null,
      waJid: account.wa_jid || null,
      qrDataUrl: null,
      lastConnectedAt: null,
      lastDisconnectAt: null,
      startTimer: null,
      deleting: false,
    };
    sessions.set(account.account_id, session);
  } else {
    session.label = account.label;
    session.phoneNumber = account.phone_number || session.phoneNumber || null;
    session.waJid = account.wa_jid || session.waJid || null;
  }
  return session;
}

function sessionStatus(session) {
  return {
    accountId: session.accountId,
    label: session.label,
    connectionState: session.connectionState,
    whatsappConnected: session.connectionState === 'connected',
    isRegistered: session.isRegistered,
    phoneNumber: maskPhone(session.phoneNumber),
    qrDataUrl: session.qrDataUrl,
    lastConnectedAt: session.lastConnectedAt,
    lastDisconnectAt: session.lastDisconnectAt,
  };
}

function getDashboardStatus() {
  const memory = process.memoryUsage();
  const accounts = [...sessions.values()].map(sessionStatus);
  return {
    botName: BOT_NAME,
    connectionState: accounts.some((account) => account.whatsappConnected)
      ? 'connected'
      : accounts.some((account) => ['starting', 'reconnecting'].includes(account.connectionState))
        ? 'starting'
        : 'offline',
    whatsappConnected: accounts.some((account) => account.whatsappConnected),
    uptimeSeconds: process.uptime(),
    memoryMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
    nodeVersion: process.version,
    accounts,
  };
}

function publishStatus() {
  dashboardEvents.emit('status');
  dashboardEvents.emit('accounts');
}

async function handleAntilink(session, msg, text) {
  const sock = session.sock;
  const from = msg.key.remoteJid;
  const settings = await getAntilinkSettings(session.accountId, from);
  if (!settings.enabled || !containsLink(text)) return false;

  const metadata = await sock.groupMetadata(from);
  const participants = metadata.participants;
  const senderJid = msg.key.participantPn || msg.key.participant;
  const senderCandidates = candidateIds(senderJid);
  const sender = participants.find((p) => participantMatches(p, senderCandidates));
  if (isAdmin(sender)) return false;

  const botCandidates = candidateIds(sock.user?.id, sock.user?.lid);
  const bot = participants.find((p) => participantMatches(p, botCandidates));
  if (!isAdmin(bot)) {
    console.log(`⚠️ Antilink triggered for ${session.accountId}, but bot is not admin`);
    return false;
  }

  try {
    await sock.sendMessage(from, { delete: msg.key });
    console.log(`🔗 Deleted link from ${senderJid} on ${session.accountId}`);
  } catch (err) {
    console.error('❌ Failed to delete link message:', err);
  }

  if (!sender) return true;
  const stage = await incrementStage(session.accountId, from, sender.jid);
  console.log(`🔗 Antilink stage for ${session.accountId}/${senderJid} → ${stage}`);

  if (stage === 1 || stage === 2) {
    await sock.sendMessage(from, {
      text: `🔗 @${userPart(sender.id)} posted a link and was warned.\nOffense ${stage}/2 before mute.`,
      mentions: [sender.id],
    });
    return true;
  }
  if (stage === 3) {
    await setMute(session.accountId, from, sender.jid, Date.now() + 60 * 60 * 1000);
    await sock.sendMessage(from, {
      text: `🔇 @${userPart(sender.id)} posted a link again and has been muted for 1 hour.`,
      mentions: [sender.id],
    });
    return true;
  }
  if (stage === 4) {
    await setMute(session.accountId, from, sender.jid, Date.now() + 24 * 60 * 60 * 1000);
    await sock.sendMessage(from, {
      text: `🔇 @${userPart(sender.id)} posted a link again and has been muted for 1 day.`,
      mentions: [sender.id],
    });
    return true;
  }

  await sock.groupParticipantsUpdate(from, [sender.id], 'remove');
  await resetStage(session.accountId, from, sender.jid);
  const quote = DISOBEDIENCE_QUOTES[Math.floor(Math.random() * DISOBEDIENCE_QUOTES.length)];
  await sock.sendMessage(from, {
    text:
      `🚫 @${userPart(sender.id)} has been removed for repeatedly posting links despite multiple warnings and mutes.\n\n` +
      `_${quote}_\n\n⚠️ Let this be a lesson to everyone else.`,
    mentions: [sender.id],
  });
  return true;
}

async function startSession(account) {
  const session = getOrCreateSession(account);
  if (startLocks.has(session.accountId)) return startLocks.get(session.accountId);

  const promise = (async () => {
    session.connectionState = 'starting';
    session.qrDataUrl = null;
    publishStatus();
    console.log(`🚀 Starting ${BOT_NAME} account ${session.accountId} (${session.label})...`);

    try {
      const { state, saveCreds } = await useDatabaseBackedAuthState(session.accountId);
      session.isRegistered = Boolean(state.creds.registered);
      if (!latestBaileysVersion) {
        const result = await fetchLatestBaileysVersion();
        latestBaileysVersion = result.version;
      }

      const sock = makeWASocket({
        version: latestBaileysVersion,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: [`${BOT_NAME} - ${session.label}`, 'Chrome', '1.0.0'],
      });
      session.sock = sock;
      sock.ev.on('creds.update', saveCreds);

      if (USE_PAIRING_CODE && !state.creds.registered && process.env.PHONE_NUMBER) {
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(process.env.PHONE_NUMBER.replace(/\D/g, ''));
            console.log(`🔗 Pairing code for ${session.accountId}:`, code);
          } catch (error) {
            console.error(`❌ Automatic pairing failed for ${session.accountId}:`, error.message);
          }
        }, 3000);
      }

      sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          if (!USE_PAIRING_CODE) qrcodeTerminal.generate(qr, { small: true });
          qrcodeImage.toDataURL(qr, { width: 320, margin: 1 })
            .then((dataUrl) => {
              session.qrDataUrl = dataUrl;
              publishStatus();
            })
            .catch((error) => console.error(`❌ QR image error for ${session.accountId}:`, error));
        }

        if (connection === 'close') {
          const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
          const shouldReconnect = !session.deleting && statusCode !== DisconnectReason.loggedOut;
          session.connectionState = shouldReconnect ? 'reconnecting' : 'logged_out';
          session.lastDisconnectAt = new Date().toISOString();
          session.qrDataUrl = null;
          session.sock = null;
          publishStatus();
          console.log(`Connection closed for ${session.accountId}. Reconnecting: ${shouldReconnect} | code: ${statusCode}`);
          if (!session.deleting && statusCode === DisconnectReason.loggedOut && session.accountId !== 'primary') {
            session.deleting = true;
            deleteSessionAccount(session.accountId)
              .then(() => {
                sessions.delete(session.accountId);
                deletionChallenges.delete(session.accountId);
                publishStatus();
                console.log(`🗑️ Removed logged-out WhatsApp profile ${session.accountId}`);
              })
              .catch((error) => {
                session.deleting = false;
                console.error(`❌ Could not remove logged-out profile ${session.accountId}:`, error.message);
              });
          }
          if (shouldReconnect && !session.startTimer) {
            session.startTimer = setTimeout(() => {
              session.startTimer = null;
              startSession(account).catch((error) => console.error(`❌ Restart failed for ${session.accountId}:`, error));
            }, 3000);
          }
        } else if (connection === 'open') {
          session.connectionState = 'connected';
          session.isRegistered = true;
          session.waJid = sock.user?.id || session.waJid;
          session.phoneNumber = phoneFromJid(session.waJid) || session.phoneNumber;
          updateSessionIdentity(session.accountId, session.phoneNumber, session.waJid)
            .catch((error) => console.error(`⚠️ Could not save identity for ${session.accountId}:`, error.message));
          session.lastConnectedAt = new Date().toISOString();
          session.qrDataUrl = null;
          publishStatus();
          console.log(`✅ ${BOT_NAME} account ${session.accountId} connected to WhatsApp`);
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg?.message) return;
        if (!isOwnerMessage(msg, session)) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        if (!msg.key.fromMe && getViewOnceMedia(msg.message)) {
          try {
            if (await getAntiViewOnceEnabled(session.accountId)) {
              const recovered = await resendViewOnce({
                sock,
                msg,
                from: msg.key.remoteJid,
                destination: sock.user?.id ? jidNormalizedUser(sock.user.id) : undefined,
                message: msg.message,
              });
              if (recovered) return;
            }
          } catch (error) {
            console.error(`❌ Anti View Once error for ${session.accountId}:`, error);
          }
        }

        if (isGroup(msg.key.remoteJid) && !msg.key.fromMe) {
          try {
            const senderJid = msg.key.participantPn || msg.key.participant;
            if (senderJid) {
              const mute = await getMute(session.accountId, msg.key.remoteJid, senderJid);
              if (mute && Number(mute.muted_until) > Date.now()) {
                await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                return;
              }
            }
          } catch (error) {
            console.error(`❌ Mute check error for ${session.accountId}:`, error);
          }
        }

        if (isGroup(msg.key.remoteJid) && !msg.key.fromMe) {
          try {
            if (await handleAntilink(session, msg, text)) return;
          } catch (error) {
            console.error(`❌ Antilink check error for ${session.accountId}:`, error);
          }
        }

        try {
          await handleMessage(sock, msg, plugins, PREFIX, session.accountId);
        } catch (error) {
          console.error(`❌ Error handling message for ${session.accountId}:`, error);
        }
      });
    } catch (error) {
      session.connectionState = 'error';
      session.sock = null;
      publishStatus();
      console.error(`🔥 Error starting account ${session.accountId}:`, error);
    }
  })();

  startLocks.set(session.accountId, promise);
  try {
    await promise;
  } finally {
    startLocks.delete(session.accountId);
  }
}

async function startAllSessions() {
  await ensureSessionSchema();
  const accounts = await listSessionAccounts();
  await Promise.all(accounts.map((account) => startSession(account)));
}

async function getPairingStatus() {
  return {
    ...getDashboardStatus(),
    accounts: [...sessions.values()].map(sessionStatus),
  };
}

async function createAndStartAccount(label) {
  if (sessions.size >= MAX_SESSIONS) throw new Error(`Maximum of ${MAX_SESSIONS} accounts reached.`);
  const account = await createSessionAccount(label);
  getOrCreateSession({ account_id: account.accountId, label: account.label });
  await startSession({ account_id: account.accountId, label: account.label });
  return sessionStatus(sessions.get(account.accountId));
}

async function waitForPairingSocket(accountId, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = sessions.get(accountId);
    if (session?.sock && session.isRegistered === false) return session;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return sessions.get(accountId);
}

function challengeHash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function secureCodeMatches(expectedHash, code) {
  const actual = Buffer.from(challengeHash(code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function requestDeletionCode(accountId) {
  const session = sessions.get(accountId);
  if (!session) throw new Error('Account not found.');
  if (accountId === 'primary') throw new Error('The primary account cannot be deleted from the public website.');
  if (!session.sock || session.connectionState !== 'connected' || !session.isRegistered) {
    throw new Error('This WhatsApp account must be connected before requesting a deletion code.');
  }
  const existing = deletionChallenges.get(accountId);
  if (existing && Date.now() - existing.requestedAt < DELETION_CODE_COOLDOWN_MS) {
    throw new Error(`A code was already sent. Try again in ${Math.ceil((DELETION_CODE_COOLDOWN_MS - (Date.now() - existing.requestedAt)) / 1000)} seconds.`);
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const selfJid = session.sock.user?.id || session.waJid;
  if (!selfJid) throw new Error('The account identity is not ready yet.');
  await session.sock.sendMessage(jidNormalizedUser(selfJid), {
    text: `🔐 Profile deletion code: ${code}\n\nThis code expires in 10 minutes. If you did not request this, ignore it.`,
  });
  deletionChallenges.set(accountId, {
    hash: challengeHash(code),
    requestedAt: Date.now(),
    attempts: 0,
  });
}

async function deleteAccountWithCode(accountId, code) {
  const session = sessions.get(accountId);
  if (!session) throw new Error('Account not found.');
  if (accountId === 'primary') throw new Error('The primary account cannot be deleted from the public website.');
  const challenge = deletionChallenges.get(accountId);
  if (!challenge || Date.now() - challenge.requestedAt > DELETION_CODE_TTL_MS) {
    deletionChallenges.delete(accountId);
    throw new Error('The deletion code is missing or expired. Request a new code.');
  }
  challenge.attempts += 1;
  if (challenge.attempts > 5) {
    deletionChallenges.delete(accountId);
    throw new Error('Too many incorrect attempts. Request a new code.');
  }
  if (!/^\d{6}$/.test(String(code || '')) || !secureCodeMatches(challenge.hash, code)) {
    throw new Error('Incorrect deletion code.');
  }
  deletionChallenges.delete(accountId);
  session.deleting = true;
  if (session.startTimer) clearTimeout(session.startTimer);
  if (session.sock?.logout) {
    try { await session.sock.logout(); } catch (error) { console.warn(`⚠️ Logout during deletion failed for ${accountId}:`, error.message); }
  }
  await deleteSessionAccount(accountId);
  sessions.delete(accountId);
  publishStatus();
}

const app = express();
app.use(express.json({ limit: '8kb' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.get('/api/pairing/status', async (req, res) => res.json(await getPairingStatus()));
app.post('/api/accounts', async (req, res) => {
  try {
    const account = await createAndStartAccount(req.body?.label);
    res.status(201).json({ account });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function handlePairingCode(req, res, accountId) {
  const session = sessions.get(accountId);
  const phoneNumber = String(req.body?.phoneNumber || '').replace(/\D/g, '');
  if (!session) return res.status(404).json({ error: 'Account not found.' });
  if (!/^\d{8,15}$/.test(phoneNumber)) return res.status(400).json({ error: 'Enter a valid phone number with country code.' });
  if (!session.sock || session.isRegistered === null) return res.status(503).json({ error: 'This account is still starting. Try again shortly.' });
  if (session.isRegistered) return res.status(409).json({ error: 'This account is already linked.' });

  const duplicate = [...sessions.values()].find((candidate) =>
    candidate.accountId !== accountId && candidate.isRegistered && candidate.phoneNumber === phoneNumber
  );
  if (duplicate) {
    return res.status(409).json({
      error: `This WhatsApp number is already connected as ${duplicate.label}.`,
      accountId: duplicate.accountId,
    });
  }

  const lastRequest = pairingRequests.get(session.accountId) || 0;
  const remaining = PAIRING_COOLDOWN_MS - (Date.now() - lastRequest);
  if (remaining > 0) return res.status(429).json({ error: `Try again in ${Math.ceil(remaining / 1000)} seconds.` });
  pairingRequests.set(session.accountId, Date.now());
  try {
    const code = await session.sock.requestPairingCode(phoneNumber);
    return res.json({ accountId: session.accountId, code });
  } catch (error) {
    console.error(`❌ Pairing-code request error for ${session.accountId}:`, error);
    return res.status(500).json({ error: 'Unable to generate a pairing code right now.' });
  }
}

app.post('/api/public/pairing-code', async (req, res) => {
  try {
    const phoneNumber = normalizePhone(req.body?.phoneNumber);
    if (!/^\d{8,15}$/.test(phoneNumber)) {
      return res.status(400).json({ error: 'Enter a valid phone number with country code.' });
    }
    const duplicate = [...sessions.values()].find((candidate) =>
      candidate.isRegistered && candidate.phoneNumber === phoneNumber
    );
    if (duplicate) {
      return res.status(409).json({ error: 'This WhatsApp number is already connected.' });
    }
    const account = await createAndStartAccount(req.body?.label || `WhatsApp ${phoneNumber.slice(-4)}`);
    const session = await waitForPairingSocket(account.accountId);
    if (!session?.sock || session.isRegistered !== false) {
      return res.status(503).json({ accountId: account.accountId, error: 'The pairing session is still starting. Please try again shortly.' });
    }
    const code = await session.sock.requestPairingCode(phoneNumber);
    res.status(201).json({ accountId: account.accountId, label: account.label, code });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/accounts/:accountId/pairing-code', (req, res) =>
  handlePairingCode(req, res, req.params.accountId)
);

app.post('/api/accounts/:accountId/deletion-code', async (req, res) => {
  try {
    await requestDeletionCode(req.params.accountId);
    res.json({ message: 'A deletion code was sent to the WhatsApp account self-chat.' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/accounts/:accountId', async (req, res) => {
  try {
    await deleteAccountWithCode(req.params.accountId, req.body?.code);
    res.json({ deleted: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Backward-compatible route for the original primary-account homepage.
app.post('/api/pairing/code', (req, res) => handlePairingCode(req, res, 'primary'));

app.use('/dashboard', createDashboardRouter({ getStatus: getDashboardStatus }));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🌐 Health check server running on port ${PORT}`));
attachDashboardWebSocket(server, { getStatus: getDashboardStatus });

startAllSessions().catch((error) => {
  console.error('🔥 Could not start WhatsApp accounts:', error);
});
