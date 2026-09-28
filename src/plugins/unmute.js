const {
  isGroup,
  candidateIds,
  participantMatches,
  isAdmin,
  getTargetJid,
  userPart,
} = require('../lib/groupUtils');
const { clearMute } = require('../lib/muteStore');

module.exports = {
  command: 'unmute',
  description: 'Remove a mute from a group member',

  execute: async ({ sock, msg, from, accountId }) => {
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
          text: '🚫 Only group admins can use `.unmute`.',
        });
        return;
      }

      const target = getTargetJid(msg);
      if (!target) {
        await sock.sendMessage(from, {
          text: '❌ Please mention the member to unmute.\n\n*Example:* `.unmute @user`',
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

      await clearMute(accountId, from, targetParticipant.jid);

      await sock.sendMessage(from, {
        text: `✅ @${userPart(targetParticipant.id)} has been unmuted.`,
        mentions: [targetParticipant.id],
      });

    } catch (error) {
      console.error('❌ Unmute command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while trying to unmute that member.',
      });
    }
  },
};