const {
  isGroup,
  candidateIds,
  participantMatches,
  isAdmin,
  getTargetJid,
  userPart,
  parseDuration,
  formatDuration,
} = require('../lib/groupUtils');
const { setMute } = require('../lib/muteStore');

module.exports = {
  command: 'mute',
  description: 'Temporarily prevent a member from messaging the group',

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
          text: '🚫 Only group admins can use `.mute`.',
        });
        return;
      }

      const botCandidates = candidateIds(sock.user?.id, sock.user?.lid);
      const bot = participants.find((p) => participantMatches(p, botCandidates));

      if (!isAdmin(bot)) {
        await sock.sendMessage(from, {
          text: '⚠️ I need to be a group admin to enforce mutes (I delete messages from muted users).',
        });
        return;
      }

      const target = getTargetJid(msg);
      if (!target) {
        await sock.sendMessage(from, {
          text:
            '❌ Please mention the member to mute.\n\n' +
            '*Example:* `.mute @user 10m`\n' +
            'Supported units: s (seconds), m (minutes), h (hours), d (days)',
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
          text: '🚫 I cannot mute another group admin.',
        });
        return;
      }

      if (participantMatches(targetParticipant, botCandidates)) {
        await sock.sendMessage(from, {
          text: '🤖 I cannot mute myself.',
        });
        return;
      }

      const rawText = (Array.isArray(args) ? args.join(' ') : (args || ''))
        .replace(/@\d+/g, '')
        .trim();

      const durationMs = parseDuration(rawText);

      if (!durationMs) {
        await sock.sendMessage(from, {
          text:
            '❌ Please specify a valid duration.\n\n' +
            '*Example:* `.mute @user 10m`\n' +
            'Supported units: s, m, h, d (e.g. 30s, 10m, 2h, 1d)',
        });
        return;
      }

      const mutedUntil = Date.now() + durationMs;
      await setMute(accountId, from, targetParticipant.jid, mutedUntil);

      await sock.sendMessage(from, {
        text:
          '╭───〔 ✦ *MUTED* ✦ 〕───╮\n' +
          '│\n' +
          `│  👤 User: @${userPart(targetParticipant.id)}\n` +
          `│  ⏱️ Duration: ${formatDuration(durationMs)}\n` +
          '│  📵 Their messages will be removed\n' +
          '│  until the mute expires.\n' +
          '│\n' +
          '╰────────────────────────╯',
        mentions: [targetParticipant.id],
      });

    } catch (error) {
      console.error('❌ Mute command error:', error);
      await sock.sendMessage(from, {
        text: '❌ Something went wrong while trying to mute that member.',
      });
    }
  },
};