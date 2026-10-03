const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const { getSettings } = require('../lib/accountSettingsStore');

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

module.exports = {
  command: 'botstatus',
  description: 'Check bot connection and feature status',
  execute: async ({ sock, from, accountId }) => {
    const start = Date.now();
    const settings = await getSettings(accountId);
    const memory = process.memoryUsage();
    const statusText = `
╭────〔 ✦ *BOT STATUS* ✦ 〕────╮
│
│  🤖 *${BOT_NAME}*
│  🟢 Status   : *ONLINE*
│  ⚡ Latency  : *${Date.now() - start}ms*
│  ⏱️ Uptime   : *${formatUptime(process.uptime())}*
│  💾 Memory   : *${(memory.rss / 1024 / 1024).toFixed(1)} MB*
│
│  💚 Auto react: *${settings.status_view_emoji ? 'ON' : 'OFF'}*
│  👁️ Auto status: *${settings.auto_status_view ? 'ON' : 'OFF'}*
│  🟢 Always online: *${settings.always_online ? 'ON' : 'OFF'}*
│  📵 Reject calls: *${settings.reject_calls ? 'ON' : 'OFF'}*
│
╰────────────────────────────╯
    `.trim();
    await sock.sendMessage(from, { text: statusText });
  },
};
