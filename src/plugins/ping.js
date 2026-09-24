module.exports = {
  command: 'ping',
  description: 'Check if the bot is alive',
  execute: async ({ sock, from }) => {
    const start = Date.now();
    await sock.sendMessage(from, { text: 'Pinging...' });
    const latency = Date.now() - start;
    await sock.sendMessage(from, {
      text: `🏓 Pong! ${latency}ms\n_Orefyspace WhatsApp Bot is online_`,
    });
  },
};