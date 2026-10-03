module.exports = {
  command: 'ai',
  description: 'Chat with AI',
  execute: async ({ sock, from, args }) => {
    const prompt = args.join(' ');
    if (!prompt) {
      await sock.sendMessage(from, { text: 'Usage: .ai <your question>' });
      return;
    }
    if (!process.env.OPENROUTER_API_KEY) {
      await sock.sendMessage(from, {
        text: 'AI is not configured yet. Set OPENROUTER_API_KEY to enable this.',
      });
      return;
    }

    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
          messages: [
            {
              role: 'system',
              content: 'You are Orefyspace Assistant, a helpful WhatsApp AI assistant.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || 'No response from AI.';
      await sock.sendMessage(from, { text: reply });
    } catch (err) {
      console.error(err);
      await sock.sendMessage(from, { text: 'AI request failed.' });
    }
  },
};