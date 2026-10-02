const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const PREFIX = process.env.PREFIX || '.';

module.exports = {
  command: ['menu', 'help'],
  description: 'Show available commands',
  execute: async ({ sock, from, msg }) => {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const uptimeSec = process.uptime();
    const h = Math.floor(uptimeSec / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    const uptime = `${h}h ${m}m`;
    const senderName = msg.pushName || 'Owner';

    const menuText = `
╭───〔 *${BOT_NAME.toUpperCase()}* 〕───╮
│
│  ➤ 👤 Owner     : *${senderName}*
│  ➤ 📅 Date      : ${date}
│  ➤ ⏰ Time      : ${time}
│  ➤ ⚡ Uptime    : ${uptime}
│  ➤ 🔧 Prefix    : [ ${PREFIX} ]
│  ➤ 🔐 Access    : Owner + group admins
│
╰──────────────────────╯

╭──〔 ✦ *GENERAL* ✦ 〕──╮
│
│  ▸ ${PREFIX}ping
│  ▸ ${PREFIX}menu
│  ▸ ${PREFIX}info
│  ▸ ${PREFIX}status
│  ▸ ${PREFIX}owner
│  ▸ ${PREFIX}settimezone <IANA timezone> (global bot time)
│  ▸ ${PREFIX}settz <IANA timezone> (global bot time)
│
╰──────────────────────╯

╭──〔 ✦ *MEDIA & AI* ✦ 〕──╮
│
│  ▸ ${PREFIX}vv (reply to view-once media)
│  ▸ ${PREFIX}antivv on/off (save view-once media to self-chat)
│  ▸ ${PREFIX}ai <text>
│
╰──────────────────────╯

╭──〔 ✦ *GROUP MODERATION* ✦ 〕──╮
│
│  ▸ ${PREFIX}antilink on/off
│  ▸ ${PREFIX}warn @user [reason]
│  ▸ ${PREFIX}warnings @user
│  ▸ ${PREFIX}delwarn @user
│  ▸ ${PREFIX}mute @user [duration]
│  ▸ ${PREFIX}unmute @user
│  ▸ ${PREFIX}ban @user
│  ▸ ${PREFIX}unban @user
│  ▸ ${PREFIX}kick @user
│  ▸ ${PREFIX}add <number>
│  ▸ ${PREFIX}groupmute
│  ▸ ${PREFIX}groupunmute
│  ▸ ${PREFIX}schedule mute HH:MM daily
│  ▸ ${PREFIX}schedule unmute HH:MM weekdays
│  ▸ ${PREFIX}schedules
│  ▸ ${PREFIX}cancelschedule <id>
│
╰────────────────────────────╯

╭──〔 ✦ *UPCOMING* ✦ 〕──╮
│
│  ✓ Scheduled group mute/unmute rules
│  ▸ Moderation analytics and reports
│  ▸ Sticker and expanded media tools
│  ▸ Multi-language command support
│  ▸ Custom owner dashboard settings
│
╰────────────────────────────╯

     ✧═══════════════✧
      *${BOT_NAME}*
      _Private Owner-Controlled Automation_
     ✧═══════════════✧

      ✨ _Powered by Orefyspace_ ✨
    `.trim();

    await sock.sendMessage(from, { text: menuText });
  },
};
