const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const PREFIX = process.env.PREFIX || '.';
const VERSION = '1.0.0';

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

module.exports = {
  command: 'info',
  description: 'Show bot information',

  execute: async ({ sock, from }) => {
    const uptime = formatUptime(process.uptime());
    const memory = process.memoryUsage();
    const memoryUsed = (memory.rss / 1024 / 1024).toFixed(1);

    const infoText = `
╭───〔 ✦ *${BOT_NAME.toUpperCase()}* ✦ 〕───╮
│
│  🤖 *BOT INFORMATION*
│
│  ▸ Name      : *${BOT_NAME}*
│  ▸ Version   : *${VERSION}*
│  ▸ Prefix    : *${PREFIX}*
│  ▸ Uptime    : *${uptime}*
│  ▸ Memory    : *${memoryUsed} MB*
│  ▸ Runtime   : *Node.js ${process.version}*
│
├───〔 ✦ *STATUS* ✦ 〕───┤
│
│  🟢 Bot Status : *Online*
│  ⚡ Engine     : *Baileys*
│  ☁️ Hosting    : *Render*
│
╰────────────────────────╯

✨ _Powered by Orefyspace_ ✨
    `.trim();

    await sock.sendMessage(from, {
      text: infoText,
    });
  },
};