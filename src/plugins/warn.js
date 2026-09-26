const {
  isGroup,
  candidateIds,
  participantMatches,
  isAdmin,
  getTargetJid,
  userPart,
} = require('../lib/groupUtils');
const { addWarning, resetWarnings } = require('../lib/warnStore');

const WARN_LIMIT = parseInt(process.env.WARN_LIMIT || '3', 10);

module.exports = {
  command: 'warn',
  description: 'Warn a group member (auto-kick at warning limit)',

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

      // -----------------------------
      // Resolve sender
      // -----------------------------
      const senderCandidates = candidateIds(
        msg.key.participant,
        msg.key.participantPn,
        msg.key.remoteJid
      );
      const sender = participants.find((p) => participantMatches(p, senderCandidates));

      if (!isAdmin(sender)) {
        await sock.sendMessage(from, {
          text: '🚫 Only group admins can use `.warn`.',
        });
        return;
      }

      // -----------------------------
      // Resolve target
      // -----------------------------
      const target = getTargetJid(msg);
      if (!target) {
        await sock.sendMessage(from, {
          text:
            '❌ Please mention the member you want to warn.\n\n' +
            '*Example:* `.warn @user Spamming links`',
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
          text: '🚫 I cannot warn another group admin.',
        });
        return;
      }

      const botCandidates = candidateIds(sock.user?.id, sock.user?.lid);
      if (participantMatches(targetParticipant, botCandidates)) {
        await sock.sendMessage(from, {
          text: '🤖 I cannot warn myself.',
        });
        return;
      }

      // -----------------------------
      // Extract reason (strip the @mention out of the text)
      // -----------------------------
      const rawText = Array.isArray(args) ? args.join(' ') : (args || '');
      const reason = rawText.replace(/@\d+/g, '').trim() || 'No reason provided';

      // -----------------------------
      // Store warning (canonical key = phone-based jid, stable across sessions)
      // -----------------------------
      const { count } = await addWarning(from, targetParticipant.jid, reason);

      await sock.sendMessage(from, {
        text:
          '╭───〔 ✦ *WARNING* ✦ 〕───╮\n' +
          '│\n' +
          `│  👤 User: @${userPart(targetParticipant.id)}\n` +
          `│  📝 Reason: ${reason}\n` +
          `│  🔢 Warnings: ${count}/${WARN_LIMIT}\n` +
          '│\n' +
          '╰────────────────────────╯',
        mentions: [targetParticipant.id],
      });

      // -----------------------------
      // Auto-kick at limit
      // -----------------------------
      if (count >= WARN_LIMIT) {
        const bot = participants.find((p) => participantMatches(p, botCandidates));

        if (!isAdmin(bot)) {
          await sock.sendMessage(from, {
            text:
              `⚠️ @${userPart(targetParticipant.id)} has reached the warning limit, ` +
              `but I need to be a group admin to remove them.`,
            mentions: [targetParticipant.id],
          });
          return;
        }

        await sock.groupParticipantsUpdate(from, [targetParticipant.id], 'remove');
        await resetWarnings(from, targetParticipant.jid);

        await sock.sendMessage(from, {
          text:
            `🚫 @${userPart(targetParticipant.id)} reached ${WARN_LIMIT} warnings ` +
            `and has been automatically removed.`,
          mentions: [targetParticipant.id],
        });
      }

    } catch (error) {
      console.error('❌ Warn command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while trying to warn that member.',
      });
    }
  },
};