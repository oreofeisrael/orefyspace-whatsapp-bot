function isGroup(jid) {
  return jid && jid.endsWith('@g.us');
}

function normalizeJid(jid) {
  if (!jid) return '';
  return jid.split(':')[0];
}

function getTargetJid(msg) {
  const context =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo;

  // First priority: mentioned user
  const mentioned = context?.mentionedJid;

  if (mentioned && mentioned.length > 0) {
    return mentioned[0];
  }

  // Second priority: quoted message sender
  if (context?.participant) {
    return context.participant;
  }

  return null;
}

function isAdmin(participant) {
  return (
    participant?.admin === 'admin' ||
    participant?.admin === 'superadmin'
  );
}

module.exports = {
  command: 'kick',
  description: 'Remove a member from the group',

  execute: async ({ sock, msg, from }) => {
    // -----------------------------
    // Check if this is a group
    // -----------------------------
    if (!isGroup(from)) {
      await sock.sendMessage(from, {
        text: '❌ This command can only be used inside a group.',
      });
      return;
    }

    try {
      // -----------------------------
      // Get group information
      // -----------------------------
      const metadata = await sock.groupMetadata(from);
      const participants = metadata.participants;

      // -----------------------------
      // Find command sender
      // -----------------------------
      const senderJid = msg.key.participant || msg.key.remoteJid;

      const sender = participants.find(
        (p) => normalizeJid(p.id) === normalizeJid(senderJid)
      );

      // -----------------------------
      // Check sender is admin
      // -----------------------------
      if (!isAdmin(sender)) {
        await sock.sendMessage(from, {
          text: '🚫 Only group admins can use `.kick`.',
        });
        return;
      }

      // -----------------------------
      // Find bot account
      // -----------------------------
      const botJid = normalizeJid(sock.user?.id);

      const bot = participants.find(
        (p) => normalizeJid(p.id) === botJid
      );

      // -----------------------------
      // Check bot is admin
      // -----------------------------
      if (!isAdmin(bot)) {
        await sock.sendMessage(from, {
          text: '⚠️ I need to be a group admin before I can remove members.',
        });
        return;
      }

      // -----------------------------
      // Find target
      // -----------------------------
      const target = getTargetJid(msg);

      if (!target) {
        await sock.sendMessage(from, {
          text:
            '❌ Please mention the member you want to remove.\n\n' +
            '*Example:* `.kick @user`',
        });
        return;
      }

      const targetJid = normalizeJid(target);

      // -----------------------------
      // Check target exists
      // -----------------------------
      const targetParticipant = participants.find(
        (p) => normalizeJid(p.id) === targetJid
      );

      if (!targetParticipant) {
        await sock.sendMessage(from, {
          text: '❌ That user is not a member of this group.',
        });
        return;
      }

      // -----------------------------
      // Prevent kicking admins
      // -----------------------------
      if (isAdmin(targetParticipant)) {
        await sock.sendMessage(from, {
          text: '🚫 I cannot remove another group admin.',
        });
        return;
      }

      // -----------------------------
      // Prevent kicking the bot
      // -----------------------------
      if (targetJid === botJid) {
        await sock.sendMessage(from, {
          text: '🤖 I cannot remove myself from the group.',
        });
        return;
      }

      // -----------------------------
      // Remove member
      // -----------------------------
      await sock.groupParticipantsUpdate(
        from,
        [targetParticipant.id],
        'remove'
      );

      // -----------------------------
      // Success message
      // -----------------------------
      await sock.sendMessage(from, {
        text:
          '╭───〔 ✦ *MODERATION* ✦ 〕───╮\n' +
          '│\n' +
          '│  ✅ *Member Removed*\n' +
          '│\n' +
          `│  👤 User: @${targetJid.split('@')[0]}\n` +
          '│  🛡️ Action: Kick\n' +
          '│\n' +
          '╰────────────────────────╯\n\n' +
          '✨ _Powered by Orefyspace_ ✨',
        mentions: [targetParticipant.id],
      });

    } catch (error) {
      console.error('❌ Kick command error:', error);

      await sock.sendMessage(from, {
        text:
          '❌ I could not remove that member.\n\n' +
          'Make sure I have permission to manage group members.',
      });
    }
  },
};