const { isGroup, candidateIds, participantMatches, isAdmin } = require('../lib/groupUtils');

module.exports = {
  command: 'groupunmute',
  description: 'Allow everyone to send messages again',

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
          text: '🚫 Only group admins can use `.groupunmute`.',
        });
        return;
      }

      const botCandidates = candidateIds(sock.user?.id, sock.user?.lid);
      const bot = participants.find((p) => participantMatches(p, botCandidates));

      if (!isAdmin(bot)) {
        await sock.sendMessage(from, {
          text: '⚠️ I need to be a group admin to change this setting.',
        });
        return;
      }

      // 'not_announcement' = everyone can send messages
      await sock.groupSettingUpdate(from, 'not_announcement');

      await sock.sendMessage(from, {
        text: '🔊 *Group unmuted.* Everyone can send messages again.',
      });

    } catch (error) {
      console.error('❌ Groupunmute command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while trying to unmute the group.',
      });
    }
  },
};