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

module.exports = {
  isGroup,
  stripDevice,
  userPart,
  candidateIds,
  participantMatches,
  isAdmin,
  getTargetJid,
};