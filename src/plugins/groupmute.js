const { isGroup, candidateIds, participantMatches, isAdmin } = require('../lib/groupUtils');

module.exports = {
  command: 'groupmute',
  description: 'Restrict the group so only admins can send messages',

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
          text: '🚫 Only group admins can use `.groupmute`.',
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

      // 'announcement' = only admins can send messages
      await sock.groupSettingUpdate(from, 'announcement');

      await sock.sendMessage(from, {
        text:
          '🔇 *Group muted.*\n\n' +
          'Only admins can send messages until `.groupunmute` is used.',
      });

    } catch (error) {
      console.error('❌ Groupmute command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while trying to mute the group.',
      });
    }
  },
};