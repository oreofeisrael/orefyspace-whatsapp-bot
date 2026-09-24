const BOT_NAME = process.env.BOT_NAME || 'Orefyspace WhatsApp Bot';
const OWNER_NAME = process.env.OWNER_NAME || 'Orefyspace';
const OWNER_NUMBER = process.env.OWNER_NUMBER || '';

module.exports = {
  command: 'owner',
  description: 'Show the bot owner information',

  execute: async ({ sock, from }) => {
    const cleanNumber = OWNER_NUMBER.replace(/\D/g, '');

    const ownerText = `
╭───〔 ✦ *BOT OWNER* ✦ 〕───╮
│
│ 👑 *Name:* ${OWNER_NAME}
│ 🤖 *Bot:* ${BOT_NAME}
│ 📱 *WhatsApp:* +${cleanNumber || 'Not configured'}
│
╰────────────────────────╯

✨ _Powered by Orefyspace_ ✨
    `.trim();

    await sock.sendMessage(from, {
      text: ownerText,
    });
  },
};