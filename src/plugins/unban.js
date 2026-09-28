const { isGroup, candidateIds, participantMatches, isAdmin } = require('../lib/groupUtils');
const { removeBan } = require('../lib/banStore');

function extractNumber(text) {
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, '');
  return digits.length >= 8 ? digits : null;
}

module.exports = {
  command: 'unban',
  description: 'Allow a previously banned number to be added again',

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
          text: '🚫 Only group admins can use `.unban`.',
        });
        return;
      }

      const inputText = Array.isArray(args) ? args.join(' ') : (args || '');
      const number = extractNumber(inputText);

      if (!number) {
        await sock.sendMessage(from, {
          text:
            '❌ Please provide the phone number to unban.\n\n' +
            '*Example:* `.unban 2348160148832`',
        });
        return;
      }

      const targetJid = `${number}@s.whatsapp.net`;
      const removed = await removeBan(accountId, from, targetJid);

      if (!removed) {
        await sock.sendMessage(from, {
          text: `ℹ️ +${number} was not banned in this group.`,
        });
        return;
      }

      await sock.sendMessage(from, {
        text: `✅ +${number} has been unbanned and can be re-added.`,
      });

    } catch (error) {
      console.error('❌ Unban command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while trying to unban that number.',
      });
    }
  },
};