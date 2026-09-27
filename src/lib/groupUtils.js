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

// Parse "10m", "2h", "1d", "30s" into milliseconds. Returns null if invalid.
function parseDuration(text) {
  if (!text) return null;
  const match = text.trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Matches http(s) links, www. links, WhatsApp invite links, and bare
// domains with common TLDs (e.g. "fiverr.com", "example.ng").
const LINK_REGEX = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(\b[a-z0-9-]+\.(com|net|org|io|co|ng|me|xyz|link|biz|info|gg|tv|app)\b)/i;

function containsLink(text) {
  if (!text) return false;
  return LINK_REGEX.test(text);
}

module.exports = {
  isGroup,
  stripDevice,
  userPart,
  candidateIds,
  participantMatches,
  isAdmin,
  getTargetJid,
  parseDuration,
  formatDuration,
  containsLink,
};