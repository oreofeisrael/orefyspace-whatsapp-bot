const {
  isGroup,
  candidateIds,
  participantMatches,
  isAdmin,
  getTargetJid,
  userPart,
} = require('../lib/groupUtils');
const { resetWarnings } = require('../lib/warnStore');

module.exports = {
  command: 'delwarn',
  description: "Clear a member's warnings",

  execute: async ({ sock, msg, from }) => {
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
          text: '🚫 Only group admins can use `.delwarn`.',
        });
        return;
      }

      const target = getTargetJid(msg);
      if (!target) {
        await sock.sendMessage(from, {
          text:
            '❌ Please mention the member whose warnings you want to clear.\n\n' +
            '*Example:* `.delwarn @user`',
        });
        return;
      }

      const targetCandidates = candidateIds(target);
      const targetParticipant = participants.find((p) =>
        participantMatches(p, targetCandidates)
      );

      if (!targetParticipant) {
        await sock.sendMessage(from, {
          text: '❌ That user is not a member of this group.',
        });
        return;
      }

      await resetWarnings(from, targetParticipant.jid);

      await sock.sendMessage(from, {
        text: `✅ Warnings cleared for @${userPart(targetParticipant.id)}.`,
        mentions: [targetParticipant.id],
      });

    } catch (error) {
      console.error('❌ Delwarn command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while clearing warnings.',
      });
    }
  },
};