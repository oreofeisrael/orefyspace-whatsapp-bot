require('dotenv').config();
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const qrcodeImage = require('qrcode');
const express = require('express');
const path = require('path');
const { createDashboardRouter, attachDashboardWebSocket } = require('./dashboard');
const dashboardEvents = require('./dashboardEvents');
const { useDatabaseBackedAuthState } = require('./auth/folderBackupAuthState');
const { loadPlugins, handleMessage } = require('./lib/commandHandler');
const { isGroup, candidateIds, participantMatches, isAdmin, containsLink, userPart } = require('./lib/groupUtils');
const { getMute, setMute } = require('./lib/muteStore');
const { getSettings: getAntilinkSettings } = require('./lib/antilinkStore');
const { incrementStage, resetStage } = require('./lib/antilinkOffenseStore');

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('🔥 Unhandled Rejection:', reason);
});

const PREFIX = process.env.PREFIX || '.';
const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const USE_PAIRING_CODE = process.env.USE_PAIRING_CODE === 'true';
const PAIRING_COOLDOWN_MS = 60 * 1000;

const DISOBEDIENCE_QUOTES = [
  "Discipline is choosing between what you want now and what you want most.",
  "Rules are not made to limit you, but to protect what you're part of.",
  "Those who ignore warnings often become the warning for others.",
  "A single act of disobedience can cost what patience took long to build.",
  "The wise learn from correction; the foolish wait for consequence.",
  "Freedom without discipline eventually destroys itself.",
  "It is better to be corrected than to be removed.",
  "Every warning ignored is a step closer to the exit.",
  "Respect the space you're given, or lose the space entirely.",
  "The rules were kind. The outcome was a choice.",
];

const plugins = loadPlugins();
console.log(`📦 Loaded ${plugins.size} command(s)`);

let sock = null;
let isStarting = false;
let connectionState = 'starting';
let lastConnectedAt = null;
let lastDisconnectAt = null;
let isRegistered = null;
let latestQrDataUrl = null;
let pairingCodeLastRequestedAt = 0;
let pairingCodeInProgress = false;

function getBotStatus() {
  const memory = process.memoryUsage();
  return {
    botName: BOT_NAME,
    connectionState,
    whatsappConnected: connectionState === 'connected',
    uptimeSeconds: process.uptime(),
    memoryMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
    lastConnectedAt,
    lastDisconnectAt,
    nodeVersion: process.version,
  };
}

function publishStatus() {
  dashboardEvents.emit('status');
  dashboardEvents.emit('pairing');
}

// -----------------------------
// Anti-link escalation ladder:
//   Stage 1, 2 → delete + warn
//   Stage 3    → delete + mute 1 hour
//   Stage 4    → delete + mute 1 day
//   Stage 5+   → delete + kick (with a closing quote)
// -----------------------------
async function handleAntilink(msg, text) {
  const from = msg.key.remoteJid;

  const settings = await getAntilinkSettings(from);
  if (!settings.enabled) return false;
  if (!containsLink(text)) return false;

  const metadata = await sock.groupMetadata(from);
  const participants = metadata.participants;

  const senderJid = msg.key.participantPn || msg.key.participant;
  const senderCandidates = candidateIds(senderJid);
  const sender = participants.find((p) => participantMatches(p, senderCandidates));

  // Admins are exempt
  if (isAdmin(sender)) return false;

  const botCandidates = candidateIds(sock.user?.id, sock.user?.lid);
  const bot = participants.find((p) => participantMatches(p, botCandidates));

  if (!isAdmin(bot)) {
    console.log('⚠️ Antilink triggered but bot is not admin — cannot delete.');
    return false;
  }

  // Always delete the offending message first
  try {
    await sock.sendMessage(from, { delete: msg.key });
    console.log('🔗 Deleted link from:', senderJid);
  } catch (err) {
    console.error('❌ Failed to delete link message:', err);
  }

  if (!sender) return true; // deleted, but can't identify sender for escalation

  const stage = await incrementStage(from, sender.jid);
  console.log('🔗 Antilink stage for', senderJid, '→', stage);

  if (stage === 1 || stage === 2) {
    await sock.sendMessage(from, {
      text:
        `🔗 @${userPart(sender.id)} posted a link and was warned.\n` +
        `Offense ${stage}/2 before mute.`,
      mentions: [sender.id],
    });
    return true;
  }

  if (stage === 3) {
    const mutedUntil = Date.now() + 60 * 60 * 1000; // 1 hour
    await setMute(from, sender.jid, mutedUntil);
    await sock.sendMessage(from, {
      text: `🔇 @${userPart(sender.id)} posted a link again and has been muted for 1 hour.`,
      mentions: [sender.id],
    });
    return true;
  }

  if (stage === 4) {
    const mutedUntil = Date.now() + 24 * 60 * 60 * 1000; // 1 day
    await setMute(from, sender.jid, mutedUntil);
    await sock.sendMessage(from, {
      text: `🔇 @${userPart(sender.id)} posted a link again and has been muted for 1 day.`,
      mentions: [sender.id],
    });
    return true;
  }

  // stage >= 5 — kick
  await sock.groupParticipantsUpdate(from, [sender.id], 'remove');
  await resetStage(from, sender.jid);

  const quote = DISOBEDIENCE_QUOTES[Math.floor(Math.random() * DISOBEDIENCE_QUOTES.length)];

  await sock.sendMessage(from, {
    text:
      `🚫 @${userPart(sender.id)} has been removed for repeatedly posting links ` +
      `despite multiple warnings and mutes.\n\n` +
      `_"${quote}"_\n\n` +
      `⚠️ Let this be a lesson to everyone else.`,
    mentions: [sender.id],
  });

  return true;
}

async function start() {
  if (isStarting) {
    console.log('⏭️ start() already in progress, skipping duplicate call');
    return;
  }
  isStarting = true;
  connectionState = 'starting';
  latestQrDataUrl = null;
  publishStatus();

  console.log(`🚀 Starting ${BOT_NAME}...`);

  try {
    const { state, saveCreds } = await useDatabaseBackedAuthState();
    isRegistered = Boolean(state.creds.registered);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: [BOT_NAME, 'Chrome', '1.0.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    if (USE_PAIRING_CODE && !state.creds.registered) {
      setTimeout(async () => {
        const phoneNumber = process.env.PHONE_NUMBER;
        const code = await sock.requestPairingCode(phoneNumber);
        console.log('🔗 Pairing code:', code);
        console.log('Enter this in WhatsApp: Linked Devices > Link with phone number');
      }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (!USE_PAIRING_CODE) {
          console.log('📱 Scan this QR code with WhatsApp:');
          qrcode.generate(qr, { small: true });
        }
        qrcodeImage.toDataURL(qr, { width: 320, margin: 1 })
          .then((dataUrl) => {
            latestQrDataUrl = dataUrl;
            publishStatus();
          })
          .catch((error) => console.error('❌ QR image error:', error));
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log('Connection closed. Reconnecting:', shouldReconnect, '| code:', statusCode);

        connectionState = shouldReconnect ? 'reconnecting' : 'logged_out';
        lastDisconnectAt = new Date().toISOString();
        latestQrDataUrl = null;
        publishStatus();

        isStarting = false;

        if (shouldReconnect) {
          setTimeout(() => start(), 3000);
        } else {
          console.log('Logged out. Delete the auth_session folder and the database backup, then re-link.');
        }
      } else if (connection === 'open') {
        connectionState = 'connected';
        lastConnectedAt = new Date().toISOString();
        isRegistered = true;
        latestQrDataUrl = null;
        publishStatus();
        console.log(`✅ ${BOT_NAME} connected to WhatsApp`);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      console.log('📨 messages.upsert fired. Type:', type);

      if (type !== 'notify') {
        console.log('⏭️ Ignored — type is not "notify"');
        return;
      }

      const msg = messages[0];

      if (!msg.message) {
        console.log('⏭️ No msg.message, skipping');
        return;
      }

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '';

      // -----------------------------
      // Mute enforcement
      // -----------------------------
      if (isGroup(msg.key.remoteJid) && !msg.key.fromMe) {
        try {
          const senderJid = msg.key.participantPn || msg.key.participant;
          if (senderJid) {
            const mute = await getMute(msg.key.remoteJid, senderJid);
            if (mute && Number(mute.muted_until) > Date.now()) {
              console.log('🔇 Deleting message from muted user:', senderJid);
              await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
              return;
            }
          }
        } catch (err) {
          console.error('❌ Mute check error:', err);
        }
      }

      // -----------------------------
      // Anti-link enforcement
      // -----------------------------
      if (isGroup(msg.key.remoteJid) && !msg.key.fromMe) {
        try {
          const handled = await handleAntilink(msg, text);
          if (handled) return;
        } catch (err) {
          console.error('❌ Antilink check error:', err);
        }
      }

      console.log(
        '🔍 Text:', text || '(non-text)',
        '| fromMe:', msg.key.fromMe,
        '| from:', msg.key.remoteJid,
        '| participant:', msg.key.participant
      );

      try {
        await handleMessage(sock, msg, plugins, PREFIX);
        console.log('✅ handleMessage completed without throwing');
      } catch (err) {
        console.error('❌ Error handling message:', err);
      }
    });

  } catch (err) {
    console.error('🔥 Error inside start():', err);
    connectionState = 'error';
    publishStatus();
    isStarting = false;
  }
}

const app = express();
app.use(express.json({ limit: '8kb' }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.get('/api/pairing/status', (req, res) => {
  res.json({
    ...getBotStatus(),
    isRegistered,
    qrDataUrl: latestQrDataUrl,
  });
});

app.post('/api/pairing/code', async (req, res) => {
  const phoneNumber = String(req.body?.phoneNumber || '').replace(/\D/g, '');

  if (!/^\d{8,15}$/.test(phoneNumber)) {
    res.status(400).json({ error: 'Enter a valid phone number with country code.' });
    return;
  }
  if (!sock || isRegistered === null) {
    res.status(503).json({ error: 'The WhatsApp socket is not ready yet. Try again shortly.' });
    return;
  }
  if (isRegistered) {
    res.status(409).json({ error: 'This bot is already linked. Log out or reset the session before pairing again.' });
    return;
  }
  if (pairingCodeInProgress) {
    res.status(429).json({ error: 'A pairing-code request is already in progress.' });
    return;
  }
  const remaining = PAIRING_COOLDOWN_MS - (Date.now() - pairingCodeLastRequestedAt);
  if (remaining > 0) {
    res.status(429).json({ error: `Try again in ${Math.ceil(remaining / 1000)} seconds.` });
    return;
  }

  pairingCodeInProgress = true;
  pairingCodeLastRequestedAt = Date.now();
  try {
    const code = await sock.requestPairingCode(phoneNumber);
    res.json({ code });
  } catch (error) {
    console.error('❌ Pairing-code request error:', error);
    res.status(500).json({ error: 'Unable to generate a pairing code right now.' });
  } finally {
    pairingCodeInProgress = false;
  }
});

app.use('/dashboard', createDashboardRouter({ getStatus: getBotStatus }));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🌐 Health check server running on port ${PORT}`));
attachDashboardWebSocket(server, { getStatus: getBotStatus });

start();
