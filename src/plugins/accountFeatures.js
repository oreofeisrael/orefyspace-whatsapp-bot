const { getSettings, setSettings } = require('../lib/accountSettingsStore');

async function toggle({ sock, from, args, accountId, key, label }) {
  const value = String(args[0] || '').toLowerCase();
  if (!['on', 'off'].includes(value)) {
    await sock.sendMessage(from, { text: `Usage: .${key === 'always_online' ? 'online' : 'call'} on|off` });
    return;
  }
  await setSettings(accountId, { [key]: value === 'on' });
  await sock.sendMessage(from, { text: `✅ ${label} ${value === 'on' ? 'enabled' : 'disabled'}.` });
}

module.exports = [
  {
    command: 'online',
    description: 'Show the bot as always online',
    execute: (context) => toggle({ ...context, key: 'always_online', label: 'Always Online' }),
  },
  {
    command: 'call',
    description: 'Automatically reject calls from non-owner numbers',
    execute: (context) => toggle({ ...context, key: 'reject_calls', label: 'Call rejection' }),
  },
];
