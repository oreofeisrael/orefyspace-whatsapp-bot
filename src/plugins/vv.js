const {
  generateForwardMessageContent,
  normalizeMessageContent,
} = require('@whiskeysockets/baileys');

const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];

function getQuotedMessage(msg) {
  const message = msg.message || {};
  return (
    message.extendedTextMessage?.contextInfo?.quotedMessage ||
    message.imageMessage?.contextInfo?.quotedMessage ||
    message.videoMessage?.contextInfo?.quotedMessage ||
    message.documentMessage?.contextInfo?.quotedMessage ||
    message.audioMessage?.contextInfo?.quotedMessage ||
    message.stickerMessage?.contextInfo?.quotedMessage ||
    null
  );
}

function unwrapViewOnce(message) {
  if (!message) return null;
  const wrapper = message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension;
  if (wrapper?.message) return wrapper.message;

  const mediaKey = Object.keys(message).find((key) => MEDIA_KEYS.includes(key));
  const media = mediaKey ? message[mediaKey] : null;
  return media?.viewOnce ? message : null;
}

function containsViewOnce(message) {
  if (!message) return false;
  if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return true;
  for (const key of ['ephemeralMessage', 'documentWithCaptionMessage', 'editedMessage']) {
    if (message[key]?.message && containsViewOnce(message[key].message)) return true;
  }
  const mediaKey = Object.keys(message).find((key) => MEDIA_KEYS.includes(key));
  return Boolean(mediaKey && message[mediaKey]?.viewOnce);
}

function getMedia(message) {
  for (const [key, value] of Object.entries(message || {})) {
    if (MEDIA_KEYS.includes(key)) return { type: key.replace('Message', ''), value };
  }
  return null;
}

function getViewOnceMedia(message) {
  if (!containsViewOnce(message)) return null;
  const normalized = normalizeMessageContent(message) || message;
  const unwrapped = unwrapViewOnce(normalized) || normalized;
  return getMedia(normalizeMessageContent(unwrapped) || unwrapped);
}

function makeForwardableMessage(msg, message) {
  return {
    ...msg,
    message,
    key: {
      ...(msg.key || {}),
      remoteJid: msg.key?.remoteJid,
      fromMe: Boolean(msg.key?.fromMe),
    },
  };
}

async function resendViewOnce({ sock, msg, from, destination, message }) {
  const sourceMessage = message || getQuotedMessage(msg);
  if (!getViewOnceMedia(sourceMessage)) return false;

  try {
    const source = makeForwardableMessage(msg, sourceMessage);
    const forwardedContent = generateForwardMessageContent(source, true);
    const normalized = normalizeMessageContent(forwardedContent) || forwardedContent;
    const media = getMedia(normalized);
    if (!media) return false;

    // The normalized content no longer has the view-once wrapper. Clear the
    // legacy flag too for clients that include it on the media object.
    media.value.viewOnce = false;
    await sock.sendMessage(destination || from, {
      forward: { ...source, message: normalized },
      force: true,
    });
    return true;
  } catch (error) {
    console.error('❌ View-once forward error:', error);
    return false;
  }
}

module.exports = {
  command: 'vv',
  description: 'Save a replied-to view-once message as normal media',
  execute: async ({ sock, msg, from }) => {
    const recovered = await resendViewOnce({ sock, msg, from });
    if (!recovered) {
      await sock.sendMessage(from, {
        text: 'Reply to a fresh view-once image, video, audio, document, or sticker with .vv.',
      }, { quoted: msg });
    }
  },
  getViewOnceMedia,
  resendViewOnce,
};
