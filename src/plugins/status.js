const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

module.exports = {
  command: 'status',
  description: 'Check the current bot status',

  execute: async ({ sock, from }) => {
    const start = Date.now();

    await sock.sendMessage(from, {
      text: '⏳ Checking bot status...',
    });

    const latency = Date.now() - start;
    const uptime = formatUptime(process.uptime());

    const memory = process.memoryUsage();
    const memoryUsed = (memory.rss / 1024 / 1024).toFixed(1);

    const statusText = `
╭────〔 ✦ *BOT STATUS* ✦ 〕────╮
│
│  🤖 *${BOT_NAME}*
│
│  🟢 Status   : *ONLINE*
│  ⚡ Latency  : *${latency}ms*
│  ⏱️ Uptime   : *${uptime}*
│  💾 Memory   : *${memoryUsed} MB*
│  🟢 WhatsApp : *CONNECTED*
│
╰────────────────────────────╯

✨ _Powered by Orefyspace_ ✨
    `.trim();

    await sock.sendMessage(from, {
      text: statusText,
    });
  },
};