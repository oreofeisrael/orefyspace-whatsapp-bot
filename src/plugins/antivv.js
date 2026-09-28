const { isGroup, candidateIds, participantMatches, isAdmin } = require('../lib/groupUtils');
const { getEnabled, setEnabled } = require('../lib/antivvStore');

module.exports = {
  command: 'antivv',
  description: 'Automatically recover view-once media in this chat',

  execute: async ({ sock, msg, from, args, accountId }) => {
    try {
      if (isGroup(from)) {
        const metadata = await sock.groupMetadata(from);
        const senderCandidates = candidateIds(
          msg.key.participant,
          msg.key.participantPn,
          msg.key.remoteJid
        );
        const sender = metadata.participants.find((participant) =>
          participantMatches(participant, senderCandidates)
        );
        if (!isAdmin(sender)) {
          await sock.sendMessage(from, { text: '🚫 Only group admins can configure `.antivv`.' });
          return;
        }
      }

      const option = (Array.isArray(args) ? args.join(' ') : String(args || ''))
        .trim()
        .toLowerCase();
      const enabled = await getEnabled(accountId, from);

      if (!option) {
        await sock.sendMessage(from, {
          text:
            '╭───〔 ✦ *ANTI VIEW ONCE* ✦ 〕───╮\n' +
            '│\n' +
            `│  Status: ${enabled ? '🟢 ON' : '🔴 OFF'}\n` +
            '│\n' +
            '│  When enabled, view-once media is\n' +
            '│  automatically resent in every chat.\n' +
            '│\n' +
            '│  Usage: `.antivv on` / `.antivv off`\n' +
            '│\n' +
            '╰────────────────────────╯',
        });
        return;
      }

      if (option === 'on') {
        await setEnabled(accountId, true);
        await sock.sendMessage(from, { text: '🟢 Anti View Once enabled globally. Recovered media will be sent to this WhatsApp account’s self-chat.' });
        return;
      }

      if (option === 'off') {
        await setEnabled(accountId, false);
        await sock.sendMessage(from, { text: '🔴 Anti View Once disabled globally for this WhatsApp account.' });
        return;
      }

      await sock.sendMessage(from, { text: '❌ Unknown option. Use `.antivv on` or `.antivv off`.' });
    } catch (error) {
      console.error('❌ Anti View Once command error:', error);
      await sock.sendMessage(from, { text: '❌ Something went wrong while configuring Anti View Once.' });
    }
  },
};
