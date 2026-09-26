function isGroup(jid) {
  return jid && jid.endsWith('@g.us');
}

function stripDevice(jid) {
  if (!jid) return '';
  return jid.split(':')[0].split('@')[0] + '@' + jid.split('@')[1];
}

function userPart(jid) {
  if (!jid) return '';
  return jid.split('@')[0].split(':')[0];
}

function candidateIds(...jids) {
  const set = new Set();
  for (const j of jids) {
    if (!j) continue;
    set.add(stripDevice(j));
    set.add(userPart(j));
  }
  return set;
}

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

function isAdmin(participant) {
  return (
    participant?.admin === 'admin' ||
    participant?.admin === 'superadmin'
  );
}

// Extract digits only from user input, e.g. "+234 816 257 2535" -> "2348162572535"
function extractNumber(text) {
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, '');
  return digits.length >= 8 ? digits : null;
}

module.exports = {
  command: 'add',
  description: 'Add a member to the group by phone number',

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
          text: '🚫 Only group admins can use `.add`.',
        });
        return;
      }

      // -----------------------------
      // Resolve bot
      // -----------------------------
      const botCandidates = candidateIds(
        sock.user?.id,
        sock.user?.lid
      );

      const bot = participants.find((p) => participantMatches(p, botCandidates));

      if (!isAdmin(bot)) {
        await sock.sendMessage(from, {
          text: '⚠️ I need to be a group admin before I can add members.',
        });
        return;
      }

      // -----------------------------
      // Parse target number
      // -----------------------------
      const inputText = Array.isArray(args) ? args.join(' ') : (args || '');
      const number = extractNumber(inputText);

      if (!number) {
        await sock.sendMessage(from, {
          text:
            '❌ Please provide a valid phone number to add.\n\n' +
            '*Example:* `.add 2348162572535`',
        });
        return;
      }

      const targetJid = `${number}@s.whatsapp.net`;

      // -----------------------------
      // Check if already in group
      // -----------------------------
      const alreadyMember = participants.find((p) =>
        participantMatches(p, candidateIds(targetJid))
      );

      if (alreadyMember) {
        await sock.sendMessage(from, {
          text: '❌ That number is already a member of this group.',
        });
        return;
      }

      // -----------------------------
      // Attempt to add
      // -----------------------------
      const result = await sock.groupParticipantsUpdate(
        from,
        [targetJid],
        'add'
      );

      const entry = result?.[0];
      const status = entry?.status;

      if (status === '200' || status === 200) {
        await sock.sendMessage(from, {
          text:
            '╭───〔 ✦ *MODERATION* ✦ 〕───╮\n' +
            '│\n' +
            '│  ✅ *Member Added*\n' +
            '│\n' +
            `│  👤 Number: +${number}\n` +
            '│  🛡️ Action: Add\n' +
            '│\n' +
            '╰────────────────────────╯\n\n' +
            '✨ _Powered by Orefyspace_ ✨',
        });
        return;
      }

      // -----------------------------
      // Blocked by privacy settings — send invite link instead
      // -----------------------------
      if (status === '403' || status === 403) {
        try {
          const inviteCode = await sock.groupInviteCode(from);
          const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;

          await sock.sendMessage(from, {
            text:
              `⚠️ +${number} has privacy settings that prevent direct adding.\n\n` +
              `I'll try sending them the invite link instead:\n${inviteLink}`,
          });

          await sock.sendMessage(targetJid, {
            text:
              `👋 You've been invited to join a WhatsApp group.\n\n` +
              `Tap to join: ${inviteLink}`,
          });
        } catch (inviteErr) {
          console.error('❌ Failed to send invite link:', inviteErr);
          await sock.sendMessage(from, {
            text:
              `⚠️ +${number} could not be added directly, and I couldn't send them ` +
              `an invite link either. They may need to be invited manually.`,
          });
        }
        return;
      }

      // -----------------------------
      // Any other unexpected status
      // -----------------------------
      await sock.sendMessage(from, {
        text: `❌ Could not add +${number}. WhatsApp returned status: ${status}`,
      });

    } catch (error) {
      console.error('❌ Add command error:', error);
      await sock.sendMessage(from, {
        text:
          '❌ Something went wrong while trying to add that member.\n\n' +
          'Make sure the number is correct and I have permission to add members.',
      });
    }
  },
};