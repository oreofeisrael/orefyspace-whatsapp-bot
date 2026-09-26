const {
  isGroup,
  candidateIds,
  participantMatches,
  getTargetJid,
  userPart,
} = require('../lib/groupUtils');
const { getWarning } = require('../lib/warnStore');

const WARN_LIMIT = parseInt(process.env.WARN_LIMIT || '3', 10);

module.exports = {
  command: 'warnings',
  description: "Check a member's warning count",

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

      const target = getTargetJid(msg);
      if (!target) {
        await sock.sendMessage(from, {
          text:
            '❌ Please mention the member whose warnings you want to check.\n\n' +
            '*Example:* `.warnings @user`',
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

      const { count, reasons } = await getWarning(from, targetParticipant.jid);

      const reasonList = reasons && reasons.length > 0
        ? reasons.map((r, i) => `   ${i + 1}. ${r}`).join('\n')
        : '   None';

      await sock.sendMessage(from, {
        text:
          '╭───〔 ✦ *WARNINGS* ✦ 〕───╮\n' +
          '│\n' +
          `│  👤 User: @${userPart(targetParticipant.id)}\n` +
          `│  🔢 Count: ${count}/${WARN_LIMIT}\n` +
          '│\n' +
          `│  📝 Reasons:\n${reasonList}\n` +
          '│\n' +
          '╰────────────────────────╯',
        mentions: [targetParticipant.id],
      });

    } catch (error) {
      console.error('❌ Warnings command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while checking warnings.',
      });
    }
  },
};