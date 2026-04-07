module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const { action, text, voice_id, model_id } = req.body || {};
    if (action === 'get_voices') {
      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey }
      });
      const data = await response.json();
      return res.status(200).json(data);
    }
    if (action === 'text_to_speech') {
      const vid = voice_id || 'pNInz6obpgDQGcFmaJgB';
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          model_id: model_id || 'eleven_multilingual_v2',
          voice_settings: { stability: 0.62, similarity_boost: 0.75 }
        })
      });
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(Buffer.from(buffer));
    }
    res.status(400).json({ error: 'Action no reconocida' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
