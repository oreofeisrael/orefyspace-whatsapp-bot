function isGroup(jid) {
  return jid && jid.endsWith('@g.us');
}

// Strip device suffix (":12") but keep domain (@s.whatsapp.net / @lid)
function stripDevice(jid) {
  if (!jid) return '';
  return jid.split(':')[0].split('@')[0] + '@' + jid.split('@')[1];
}

// Extract just the numeric/user portion, ignoring domain entirely
function userPart(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0];
}

// Build every possible identifier we can find for a "sender-like" object
function candidateIds(...jids) {
  const set = new Set();
  for (const j of jids) {
    if (!j) continue;
    set.add(stripDevice(j));
    set.add(userPart(j));
  }
  return set;
}

// Does this participant match any of the candidate identifiers?
function participantMatches(participant, candidates) {
  const ids = [
    participant.id,
    participant.jid,
    participant.lid,
    participant.phoneNumber,
  ].filter(Boolean);

  for (const id of ids) {
    if (candidates.has(stripDevice(id)) || candidates.has(userPart(id))) {
      return true;
    }
  }
  return false;
}

function getTargetJid(msg) {
  const context =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo;

  const mentioned = context?.mentionedJid;
  if (mentioned && mentioned.length > 0) {
    return mentioned[0];
  }

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
      // DEBUG — remove once confirmed working
      // -----------------------------
      console.log('🔍 msg.key:', JSON.stringify(msg.key, null, 2));
      console.log('🔍 sock.user:', JSON.stringify(sock.user, null, 2));
      console.log(
        '🔍 participants:',
        JSON.stringify(
          participants.map((p) => ({ id: p.id, jid: p.jid, lid: p.lid, admin: p.admin })),
          null,
          2
        )
      );

      // -----------------------------
      // Resolve sender
      // -----------------------------
      const senderCandidates = candidateIds(
        msg.key.participant,
        msg.key.participantAlt,
        msg.key.participantPn,
        msg.key.remoteJid
      );

      const sender = participants.find((p) => participantMatches(p, senderCandidates));

      console.log('🔍 senderCandidates:', [...senderCandidates]);
      console.log('🔍 matched sender:', sender);

      if (!isAdmin(sender)) {
        await sock.sendMessage(from, {
          text: '🚫 Only group admins can use `.kick`.',
        });
        return;
      }

      // -----------------------------
      // Resolve bot
      // -----------------------------
      const botCandidates = candidateIds(
        sock.user?.id,
        sock.user?.lid,
        sock.user?.jid
      );

      const bot = participants.find((p) => participantMatches(p, botCandidates));

      console.log('🔍 botCandidates:', [...botCandidates]);
      console.log('🔍 matched bot:', bot);

      if (!isAdmin(bot)) {
        await sock.sendMessage(from, {
          text: '⚠️ I need to be a group admin before I can remove members.',
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
            '❌ Please mention the member you want to remove.\n\n' +
            '*Example:* `.kick @user`',
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
          text: '🚫 I cannot remove another group admin.',
        });
        return;
      }

      if (participantMatches(targetParticipant, botCandidates)) {
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

      await sock.sendMessage(from, {
        text:
          '╭───〔 ✦ *MODERATION* ✦ 〕───╮\n' +
          '│\n' +
          '│  ✅ *Member Removed*\n' +
          '│\n' +
          `│  👤 User: @${userPart(targetParticipant.id)}\n` +
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