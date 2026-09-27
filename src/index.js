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
const { isGroup, candidateIds, participantMatches, isAdmin, containsLink, userPart } = require('./lib/groupUtils');
const { getMute } = require('./lib/muteStore');
const { getSettings: getAntilinkSettings } = require('./lib/antilinkStore');
const { addWarning, resetWarnings } = require('./lib/warnStore');

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('🔥 Unhandled Rejection:', reason);
});

const PREFIX = process.env.PREFIX || '.';
const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const USE_PAIRING_CODE = process.env.USE_PAIRING_CODE === 'true';
const WARN_LIMIT = parseInt(process.env.WARN_LIMIT || '3', 10);

const plugins = loadPlugins();
console.log(`📦 Loaded ${plugins.size} command(s)`);

let sock = null;
let isStarting = false;

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

  // Always delete the offending message
  try {
    await sock.sendMessage(from, { delete: msg.key });
    console.log('🔗 Deleted link from:', senderJid);
  } catch (err) {
    console.error('❌ Failed to delete link message:', err);
  }

  if (!sender) return true; // deleted, but can't identify sender for warn/kick

  if (settings.action === 'warn') {
    const { count } = await addWarning(from, sender.jid, 'Posting links');

    await sock.sendMessage(from, {
      text:
        `🔗 @${userPart(sender.id)} posted a link and was warned.\n` +
        `Warnings: ${count}/${WARN_LIMIT}`,
      mentions: [sender.id],
    });

    if (count >= WARN_LIMIT) {
      await sock.groupParticipantsUpdate(from, [sender.id], 'remove');
      await resetWarnings(from, sender.jid);
      await sock.sendMessage(from, {
        text: `🚫 @${userPart(sender.id)} reached ${WARN_LIMIT} warnings and was removed.`,
        mentions: [sender.id],
      });
    }
  } else if (settings.action === 'kick') {
    await sock.groupParticipantsUpdate(from, [sender.id], 'remove');
    await sock.sendMessage(from, {
      text: `🚫 @${userPart(sender.id)} was removed for posting a link.`,
      mentions: [sender.id],
    });
  } else {
    // action === 'delete'
    await sock.sendMessage(from, {
      text: `🔗 Links are not allowed here, @${userPart(sender.id)}.`,
      mentions: [sender.id],
    });
  }

  return true;
}

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

        isStarting = false;

        if (shouldReconnect) {
          setTimeout(() => start(), 3000);
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
    isStarting = false;
  }
}

const app = express();
app.get('/', (req, res) => res.send(`${BOT_NAME} is alive`));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Health check server running on port ${PORT}`));

start();