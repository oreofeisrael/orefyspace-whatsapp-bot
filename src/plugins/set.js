const { getTimezone, setTimezone } = require('../lib/timezoneStore');

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  command: ['settimezone', 'settz'],
  description: 'Set the account timezone',
  execute: async ({ sock, from, args, accountId }) => {
    const timezone = String(args.join(' ') || '').trim();
    if (!timezone) {
      await sock.sendMessage(from, { text: 'Usage: `.settimezone Africa/Lagos`\nAlias: `.settz Africa/Lagos`' });
      return;
    }
    if (!isValidTimezone(timezone)) {
      await sock.sendMessage(from, {
        text: '❌ Invalid timezone. Use an IANA timezone such as `Africa/Lagos`, `America/New_York`, or `Europe/London`.',
      });
      return;
    }
    await setTimezone(accountId, timezone);
    await sock.sendMessage(from, {
      text: `🌍 Bot timezone set to *${timezone}*.\n\nThis applies account-wide, including all groups and private bot features. Recurring moderation schedules will use this timezone.`,
    });
  },
};
