require('dotenv').config();
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

    if (qr && !USE_PAIRING_CODE) {
      console.log('📱 Scan this QR code with WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) start();
      else console.log('Logged out. Delete the auth_session folder and the database backup, then re-link.');
    } else if (connection === 'open') {
      console.log(`✅ ${BOT_NAME} connected to WhatsApp`);
    }
  });

  const plugins = loadPlugins();
  console.log(`📦 Loaded ${plugins.size} command(s)`);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg.message) return;

    // Self-bot design: messages from the bot's own account are allowed
    // to trigger commands too. Only the command prefix decides what runs,
    // so normal outgoing chat messages (without the prefix) are ignored
    // and there's no risk of an infinite loop.

    try {
      await handleMessage(sock, msg, plugins, PREFIX);
    } catch (err) {
      console.error('❌ Error handling message:', err);
    }
  });
}

// Lightweight HTTP server so an external uptime pinger (e.g. UptimeRobot)
// can keep this service awake on hosts that sleep free instances after
// a period of inactivity (like Render's free tier).
const app = express();
app.get('/', (req, res) => res.send(`${BOT_NAME} is alive`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Health check server running on port ${PORT}`));

start().catch((err) => console.error('Fatal error:', err));