const { isGroup, candidateIds, participantMatches, isAdmin } = require('../lib/groupUtils');
const { getSettings, setEnabled } = require('../lib/antilinkStore');

module.exports = {
  command: 'antilink',
  description: 'Toggle automatic link detection and escalating punishment',

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

      const rawArgs = (Array.isArray(args) ? args.join(' ') : (args || '')).trim().toLowerCase();

      if (!rawArgs) {
        const settings = await getSettings(from);
        await sock.sendMessage(from, {
          text:
            '╭───〔 ✦ *ANTILINK* ✦ 〕───╮\n' +
            '│\n' +
            `│  Status: ${settings.enabled ? '🟢 ON' : '🔴 OFF'}\n` +
            '│\n' +
            '│  Escalation on repeated links:\n' +
            '│  1st & 2nd → delete + warn\n' +
            '│  3rd → delete + mute 1h\n' +
            '│  4th → delete + mute 1d\n' +
            '│  5th → delete + kick\n' +
            '│\n' +
            '│  Usage: `.antilink on` / `.antilink off`\n' +
            '│\n' +
            '╰────────────────────────╯',
        });
        return;
      }

      if (rawArgs === 'on') {
        await setEnabled(from, true);
        await sock.sendMessage(from, { text: '🟢 Anti-link enabled for this group.' });
        return;
      }

      if (rawArgs === 'off') {
        await setEnabled(from, false);
        await sock.sendMessage(from, { text: '🔴 Anti-link disabled for this group.' });
        return;
      }

      await sock.sendMessage(from, {
        text: '❌ Unknown option. Use `.antilink on` or `.antilink off`.',
      });

    } catch (error) {
      console.error('❌ Antilink command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while configuring anti-link.',
      });
    }
  },
};