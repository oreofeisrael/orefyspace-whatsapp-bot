const { downloadContentFromMessage, normalizeMessageContent } = require('@whiskeysockets/baileys');

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

async function downloadMedia(media) {
  if (!media.value?.mediaKey) {
    const error = new Error('View-once media no longer contains a usable decryption key');
    error.code = 'MISSING_VIEW_ONCE_MEDIA_KEY';
    throw error;
  }
  const stream = await downloadContentFromMessage(media.value, media.type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function resendViewOnce({ sock, msg, from, message }) {
  const source = message || getQuotedMessage(msg);
  const media = getViewOnceMedia(source);
  if (!media) return false;

  try {
    const buffer = await downloadMedia(media);
    const caption = media.value.caption || '';
    const options = { caption, mimetype: media.value.mimetype };
    let payload;

    if (media.type === 'image') payload = { image: buffer, ...options };
    else if (media.type === 'video') payload = { video: buffer, ...options, gifPlayback: Boolean(media.value.gifPlayback) };
    else if (media.type === 'audio') payload = { audio: buffer, mimetype: media.value.mimetype || 'audio/mp4', ptt: Boolean(media.value.ptt) };
    else if (media.type === 'document') payload = { document: buffer, ...options, fileName: media.value.fileName || 'view-once-document' };
    else payload = { sticker: buffer };

    await sock.sendMessage(from, payload, { quoted: msg });
    return true;
  } catch (error) {
    if (error.code === 'MISSING_VIEW_ONCE_MEDIA_KEY') {
      console.warn('⚠️ View-once media key is missing; it may have already expired or been viewed.');
    } else {
      console.error('❌ View-once download error:', error);
    }
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
        text: 'Reply to a view-once image, video, audio, document, or sticker with .vv.',
      }, { quoted: msg });
    }
  },
  getViewOnceMedia,
  resendViewOnce,
};
