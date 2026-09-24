require('dotenv').config();

// ─────────────────────────────────────────────
// Suppress libsignal's internal session dumps.
// These print raw private key material to the logs
// and can't be silenced via pino because libsignal
// calls console.* directly. Only these specific
// messages are dropped; everything else passes through.
// ─────────────────────────────────────────────
const SUPPRESSED_LOG_PREFIXES = [
  'Closing session',
  'Opening session',
  'Removing old closed session',
  'Session already closed',
  'Session already open',
];

function shouldSuppress(args) {
  const first = args[0];
  return (
    typeof first === 'string' &&
    SUPPRESSED_LOG_PREFIXES.some((prefix) => first.startsWith(prefix))
  );
}

for (const method of ['log', 'info', 'warn']) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (shouldSuppress(args)) return;
    original(...args);
  };
}

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const { useDatabaseBackedAuthState } = require('./auth/folderBackupAuthState');
const { loadPlugins, handleMessage } = require('./lib/commandHandler');

// Prevent the whole process from crashing on unexpected errors deep
// inside Baileys/libsignal. We log them instead of letting Node exit.
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('🔥 Unhandled Rejection:', reason);
});

const PREFIX = process.env.PREFIX || '.';
const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const USE_PAIRING_CODE = process.env.USE_PAIRING_CODE === 'true';
const RECONNECT_DELAY_MS = 3000;

function extractText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  );
}

async function start() {
  console.log(`🚀 Starting ${BOT_NAME}...`);

  const { state, saveCreds } = await useDatabaseBackedAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: [BOT_NAME, 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  // ─────────────────────────────────────────────
  // Pairing code (optional alternative to QR)
  // ─────────────────────────────────────────────
  if (USE_PAIRING_CODE && !state.creds.registered) {
    setTimeout(async () => {
      try {
        const phoneNumber = process.env.PHONE_NUMBER;
        const code = await sock.requestPairingCode(phoneNumber);
        console.log('🔗 Pairing code:', code);
        console.log('Enter this in WhatsApp: Linked Devices > Link with phone number');
      } catch (err) {
        console.error('❌ Failed to request pairing code:', err);
      }
    }, 3000);
  }

  // ─────────────────────────────────────────────
  // Connection lifecycle
  // ─────────────────────────────────────────────
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !USE_PAIRING_CODE) {
      console.log('📱 Scan this QR code with WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`🔌 Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(() => {
          start().catch((err) => console.error('Fatal error on reconnect:', err));
        }, RECONNECT_DELAY_MS);
      } else {
        console.log('Logged out. Delete the auth_session folder and the database backup, then re-link.');
      }
    } else if (connection === 'open') {
      console.log(`✅ ${BOT_NAME} connected to WhatsApp`);
    }
  });

  // ─────────────────────────────────────────────
  // Plugins
  // ─────────────────────────────────────────────
  const plugins = loadPlugins();
  console.log(`📦 Loaded ${plugins.size} command(s)`);

  // ─────────────────────────────────────────────
  // Incoming messages
  // ─────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // DEBUG: remove once message flow is confirmed
    console.log(`📨 messages.upsert fired | type: ${type} | count: ${messages.length}`);

    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) {
        console.log('⏭️ Skipped: no msg.message (possibly failed decryption or a system message)');
        continue;
      }

      const text = extractText(msg.message);

      // DEBUG: remove once message flow is confirmed
      console.log(
        '🔍 Incoming |',
        `text: "${text || '(non-text)'}"`,
        `| fromMe: ${msg.key.fromMe}`,
        `| chat: ${msg.key.remoteJid}`,
        `| participant: ${msg.key.participant || '-'}`,
        `| participantPn: ${msg.key.participantPn || '-'}`
      );

      // Self-bot design: messages from the bot's own account can trigger
      // commands too. Only the prefix decides what runs, so normal chat
      // messages are ignored and there's no infinite loop risk.
      try {
        await handleMessage(sock, msg, plugins, PREFIX);

        if (text.startsWith(PREFIX)) {
          console.log(`✅ handleMessage completed for: "${text}"`);
        }
      } catch (err) {
        console.error('❌ Error handling message:', err);
      }
    }
  });
}

// ─────────────────────────────────────────────
// Health check server for UptimeRobot
// (keeps Render's free tier from sleeping)
// ─────────────────────────────────────────────
const app = express();
app.get('/', (req, res) => res.send(`${BOT_NAME} is alive`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Health check server running on port ${PORT}`));

start().catch((err) => console.error('Fatal error:', err));