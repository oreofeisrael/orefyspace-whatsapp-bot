const fs = require('fs');
const path = require('path');

function loadPlugins() {
  const pluginsDir = path.join(__dirname, '..', 'plugins');
  const plugins = new Map();

  for (const file of fs.readdirSync(pluginsDir)) {
    if (!file.endsWith('.js')) continue;
    const plugin = require(path.join(pluginsDir, file));
    if (plugin.command && typeof plugin.execute === 'function') {
      const commands = Array.isArray(plugin.command) ? plugin.command : [plugin.command];
      for (const cmd of commands) {
        plugins.set(cmd.toLowerCase(), plugin);
      }
    }
  }
  return plugins;
}

function getMessageText(msg) {
  const m = msg.message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

async function handleMessage(sock, msg, plugins, prefix) {
  const text = getMessageText(msg).trim();
  if (!text.startsWith(prefix)) return;

  const [cmdRaw, ...args] = text.slice(prefix.length).trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  const plugin = plugins.get(cmd);
  if (!plugin) return;

  const from = msg.key.remoteJid;
  await plugin.execute({ sock, msg, args, from, text });
}

module.exports = { loadPlugins, handleMessage };