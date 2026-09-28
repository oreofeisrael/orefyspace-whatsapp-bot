const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const PREFIX = process.env.PREFIX || '.';

module.exports = {
  command: ['menu', 'help'],
  description: 'Show available commands',
  execute: async ({ sock, from, msg }) => {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const uptimeSec = process.uptime();
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const uptime = `${h}h ${m}m`;

    const senderName = msg.pushName || 'User';

    const menuText = `
╭───〔 *${BOT_NAME.toUpperCase()}* 〕───╮
│
│  ➤ 👤 User      : *${senderName}*
│  ➤ 📅 Date      : ${date}
│  ➤ ⏰ Time      : ${time}
│  ➤ ⚡ Uptime    : ${uptime}
│  ➤ 🔧 Prefix    : [ ${PREFIX} ]
│
╰──────────────────────╯

╭──〔 ✦ *GENERAL* ✦ 〕──╮
│
│  ▸ ${PREFIX}ping
│  ▸ ${PREFIX}menu
│  ▸ ${PREFIX}vv (reply to view-once media)
│
╰──────────────────────╯

╭──〔 ✦ *AI TOOLS* ✦ 〕──╮
│
│  ▸ ${PREFIX}ai <text>
│
╰──────────────────────╯

╭──〔 ✦ *UPCOMING* ✦ 〕──╮
│
│  ▸ Group Moderation
│  ▸ Sticker & Media Tools
│  ▸ Multi-language Support
│
╰──────────────────────╯

     ✧═══════════════✧
      *${BOT_NAME}*
      _Premium WhatsApp Automation_
     ✧═══════════════✧

      ✨ _Powered by Orefyspace_ ✨
    `.trim();

    await sock.sendMessage(from, { text: menuText });
  },
};
