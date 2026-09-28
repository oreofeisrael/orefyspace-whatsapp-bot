const {
  isGroup,
  candidateIds,
  participantMatches,
  isAdmin,
  getTargetJid,
  userPart,
} = require('../lib/groupUtils');
const { addBan } = require('../lib/banStore');

module.exports = {
  command: 'ban',
  description: 'Remove a member and prevent them from being re-added',

  execute: async ({ sock, msg, from, args, accountId }) => {
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
          text: '🚫 Only group admins can use `.ban`.',
        });
        return;
      }

      const botCandidates = candidateIds(sock.user?.id, sock.user?.lid);
      const bot = participants.find((p) => participantMatches(p, botCandidates));

      if (!isAdmin(bot)) {
        await sock.sendMessage(from, {
          text: '⚠️ I need to be a group admin before I can ban members.',
        });
        return;
      }

      const target = getTargetJid(msg);
      if (!target) {
        await sock.sendMessage(from, {
          text:
            '❌ Please mention the member you want to ban.\n\n' +
            '*Example:* `.ban @user Repeated spam`',
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

      if (isAdmin(targetParticipant)) {
        await sock.sendMessage(from, {
          text: '🚫 I cannot ban another group admin.',
        });
        return;
      }

      if (participantMatches(targetParticipant, botCandidates)) {
        await sock.sendMessage(from, {
          text: '🤖 I cannot ban myself.',
        });
        return;
      }

      const rawText = (Array.isArray(args) ? args.join(' ') : (args || ''))
        .replace(/@\d+/g, '')
        .trim();
      const reason = rawText || 'No reason provided';

      // Record the ban BEFORE removing, so if the kick fails partway
      // we still have the ban recorded (safer than the reverse order).
      await addBan(accountId, from, targetParticipant.jid, reason);

      await sock.groupParticipantsUpdate(from, [targetParticipant.id], 'remove');

      await sock.sendMessage(from, {
        text:
          '╭───〔 ✦ *BANNED* ✦ 〕───╮\n' +
          '│\n' +
          `│  👤 User: @${userPart(targetParticipant.id)}\n` +
          `│  📝 Reason: ${reason}\n` +
          '│  🚫 They cannot be re-added\n' +
          '│  until `.unban` is used.\n' +
          '│\n' +
          '╰────────────────────────╯',
        mentions: [targetParticipant.id],
      });

    } catch (error) {
      console.error('❌ Ban command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while trying to ban that member.',
      });
    }
  },
};