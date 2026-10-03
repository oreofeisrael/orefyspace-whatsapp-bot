const { getSettings, setSettings } = require('../lib/accountSettingsStore');

module.exports = {
  command: 'react',
  description: 'Turn automatic green-heart reactions on or off',
  execute: async ({ sock, from, args, accountId }) => {
    const value = String(args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(value)) {
      await sock.sendMessage(from, { text: 'Usage: .react on|off\nEmoji: 💚' });
      return;
    }
    await setSettings(accountId, { status_view_emoji: value === 'on' });
    await sock.sendMessage(from, {
      text: value === 'on'
        ? '✅ Auto-reaction enabled. Incoming messages will receive a 💚 reaction.'
        : '✅ Auto-reaction disabled.',
    });
  },
};
