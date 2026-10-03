const { getSettings, setSettings } = require('../lib/accountSettingsStore');

module.exports = {
  command: 'status',
  description: 'Turn automatic WhatsApp status viewing on or off',
  execute: async ({ sock, from, args, accountId }) => {
    const value = String(args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(value)) {
      await sock.sendMessage(from, {
        text: 'Usage:\n.status on\n.status off\n.status on no-dl\n.status on jid',
      });
      return;
    }

    const current = await getSettings(accountId);
    const options = new Set(args.slice(1).map((arg) => String(arg).toLowerCase()));
    const unknown = [...options].filter((option) => !['no-dl', 'jid'].includes(option));
    if (unknown.length) {
      await sock.sendMessage(from, { text: `Unknown status option: ${unknown.join(', ')}\nUse no-dl or jid.` });
      return;
    }

    const patch = { auto_status_view: value === 'on' };
    if (value === 'on' && options.has('no-dl')) patch.auto_status_download = false;
    if (value === 'on' && options.has('jid')) patch.auto_status_include_jid = true;
    if (value === 'off') {
      patch.auto_status_download = current.auto_status_download;
      patch.auto_status_include_jid = current.auto_status_include_jid;
    }
    await setSettings(accountId, patch);

    const settings = await getSettings(accountId);
    await sock.sendMessage(from, {
      text: value === 'on'
        ? `✅ Auto Status View enabled.${settings.auto_status_download ? '\n📥 Status media will be downloaded to your self-chat.' : '\n👁️ View-only mode enabled (no download).'}${settings.auto_status_include_jid ? '\n🆔 Sender JID will be included.' : ''}`
        : '✅ Auto Status View disabled.',
    });
  },
};
