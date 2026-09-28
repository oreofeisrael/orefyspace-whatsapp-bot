require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const express = require('express');
const path = require('path');
const {
  createDashboardRouter,
  attachDashboardWebSocket,
} = require('./dashboard');
const dashboardEvents = require('./dashboardEvents');
const {
  ensureSessionSchema,
  listSessionAccounts,
  createSessionAccount,
  useDatabaseBackedAuthState,
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
const { getSettings: getAntilinkSettings } = require('./lib/antilinkStore');
const { incrementStage, resetStage } = require('./lib/antilinkOffenseStore');

process.on('uncaughtException', (err) => console.error('🔥 Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('🔥 Unhandled Rejection:', reason));

const PREFIX = process.env.PREFIX || '.';
const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const USE_PAIRING_CODE = process.env.USE_PAIRING_CODE === 'true';
const PAIRING_COOLDOWN_MS = 60 * 1000;
const MAX_SESSIONS = Math.max(1, Number.parseInt(process.env.MAX_SESSIONS || '10', 10));

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
let latestBaileysVersion;

function getOrCreateSession(account) {
  let session = sessions.get(account.account_id);
  if (!session) {
    session = {
      accountId: account.account_id,
      label: account.label,
      sock: null,
      connectionState: 'starting',
      isRegistered: null,
      qrDataUrl: null,
      lastConnectedAt: null,
      lastDisconnectAt: null,
      startTimer: null,
    };
    sessions.set(account.account_id, session);
  } else {
    session.label = account.label;
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
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          session.connectionState = shouldReconnect ? 'reconnecting' : 'logged_out';
          session.lastDisconnectAt = new Date().toISOString();
          session.qrDataUrl = null;
          session.sock = null;
          publishStatus();
          console.log(`Connection closed for ${session.accountId}. Reconnecting: ${shouldReconnect} | code: ${statusCode}`);
          if (shouldReconnect && !session.startTimer) {
            session.startTimer = setTimeout(() => {
              session.startTimer = null;
              startSession(account).catch((error) => console.error(`❌ Restart failed for ${session.accountId}:`, error));
            }, 3000);
          }
        } else if (connection === 'open') {
          session.connectionState = 'connected';
          session.isRegistered = true;
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
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

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

app.post('/api/accounts/:accountId/pairing-code', (req, res) =>
  handlePairingCode(req, res, req.params.accountId)
);

// Backward-compatible route for the original primary-account homepage.
app.post('/api/pairing/code', (req, res) => handlePairingCode(req, res, 'primary'));

app.use('/dashboard', createDashboardRouter({ getStatus: getDashboardStatus }));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🌐 Health check server running on port ${PORT}`));
attachDashboardWebSocket(server, { getStatus: getDashboardStatus });

startAllSessions().catch((error) => {
  console.error('🔥 Could not start WhatsApp accounts:', error);
});
