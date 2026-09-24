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

// Loaded once — no need to reload plugins on every reconnect.
const plugins = loadPlugins();
console.log(`📦 Loaded ${plugins.size} command(s)`);

let sock = null;
let isStarting = false;

async function start() {
  if (isStarting) {
    console.log('⏭️ start() already in progress, skipping duplicate call');
    return;
  }
  isStarting = true;

  console.log(`🚀 Starting ${BOT_NAME}...`);

  try {
    const { state, saveCreds } = await useDatabaseBackedAuthState();
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

      if (qr && !USE_PAIRING_CODE) {
        console.log('📱 Scan this QR code with WhatsApp:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log('Connection closed. Reconnecting:', shouldReconnect, '| code:', statusCode);

        isStarting = false; // allow a future start() call

        if (shouldReconnect) {
          setTimeout(() => start(), 3000); // delay avoids rapid reconnect storms
        } else {
          console.log('Logged out. Delete the auth_session folder and the database backup, then re-link.');
        }
      } else if (connection === 'open') {
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
        '(non-text)';

      console.log(
        '🔍 Text:', text,
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
    isStarting = false;
  }
}

// Lightweight HTTP server so an external uptime pinger (e.g. UptimeRobot)
// can keep this service awake on hosts that sleep free instances after
// a period of inactivity (like Render's free tier).
const app = express();
app.get('/', (req, res) => res.send(`${BOT_NAME} is alive`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Health check server running on port ${PORT}`));

start();