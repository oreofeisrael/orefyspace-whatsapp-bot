const { isGroup, candidateIds, participantMatches, isAdmin } = require('../lib/groupUtils');
const { getSettings, setEnabled, setAction } = require('../lib/antilinkStore');

const VALID_ACTIONS = ['delete', 'warn', 'kick'];

module.exports = {
  command: 'antilink',
  description: 'Configure automatic link detection and removal',

  execute: async ({ sock, msg, from, args }) => {
    if (!isGroup(from)) {
      await sock.sendMessage(from, {
        text: '❌ This command can only be used inside a group.',
      });
      return;
    }

    try {
      const metadata = await sock.groupMetadata(from);
      const participants = metadata.participants;

      const senderCandidates = candidateIds(
        msg.key.participant,
        msg.key.participantPn,
        msg.key.remoteJid
      );
      const sender = participants.find((p) => participantMatches(p, senderCandidates));

      if (!isAdmin(sender)) {
        await sock.sendMessage(from, {
          text: '🚫 Only group admins can configure `.antilink`.',
        });
        return;
      }

      const rawArgs = Array.isArray(args) ? args.join(' ') : (args || '');
      const parts = rawArgs.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const sub = parts[0];

      if (!sub) {
        const settings = await getSettings(from);
        await sock.sendMessage(from, {
          text:
            '╭───〔 ✦ *ANTILINK* ✦ 〕───╮\n' +
            '│\n' +
            `│  Status : ${settings.enabled ? '🟢 ON' : '🔴 OFF'}\n` +
            `│  Action : ${settings.action}\n` +
            '│\n' +
            '│  Usage:\n' +
            '│  `.antilink on`\n' +
            '│  `.antilink off`\n' +
            '│  `.antilink set delete|warn|kick`\n' +
            '│\n' +
            '╰────────────────────────╯',
        });
        return;
      }

      if (sub === 'on') {
        await setEnabled(from, true);
        await sock.sendMessage(from, { text: '🟢 Anti-link enabled for this group.' });
        return;
      }

      if (sub === 'off') {
        await setEnabled(from, false);
        await sock.sendMessage(from, { text: '🔴 Anti-link disabled for this group.' });
        return;
      }

      if (sub === 'set') {
        const action = parts[1];
        if (!VALID_ACTIONS.includes(action)) {
          await sock.sendMessage(from, {
            text: `❌ Invalid action. Choose one of: ${VALID_ACTIONS.join(', ')}`,
          });
          return;
        }
        await setAction(from, action);
        await sock.sendMessage(from, {
          text: `✅ Anti-link action set to *${action}*.`,
        });
        return;
      }

      await sock.sendMessage(from, {
        text:
          '❌ Unknown option.\n\n' +
          '*Usage:*\n' +
          '`.antilink on`\n' +
          '`.antilink off`\n' +
          '`.antilink set delete|warn|kick`',
      });

    } catch (error) {
      console.error('❌ Antilink command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while configuring anti-link.',
      });
    }
  },
};