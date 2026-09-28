const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

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

  const mediaType = Object.keys(message).find((key) =>
    ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(key)
  );
  const media = mediaType ? message[mediaType] : null;
  if (media?.viewOnce) return message;
  return null;
}

function getMedia(message) {
  for (const [type, value] of Object.entries(message || {})) {
    if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(type)) {
      return { type: type.replace('Message', ''), value };
    }
  }
  return null;
}

async function downloadMedia(media) {
  const stream = await downloadContentFromMessage(media.value, media.type);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

module.exports = {
  command: 'vv',
  description: 'Save a replied-to view-once message as normal media',

  execute: async ({ sock, msg, from }) => {
    const quoted = getQuotedMessage(msg);
    const viewOnce = unwrapViewOnce(quoted);
    const media = getMedia(viewOnce);

    if (!media) {
      await sock.sendMessage(from, {
        text: 'Reply to a view-once image, video, audio, document, or sticker with .vv.',
      }, { quoted: msg });
      return;
    }

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
    } catch (error) {
      console.error('❌ View-once download error:', error);
      await sock.sendMessage(from, {
        text: 'I could not retrieve that view-once message. It may have expired or the media download failed.',
      }, { quoted: msg });
    }
  },
};
