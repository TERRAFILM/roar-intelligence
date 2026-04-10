module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const key = process.env.ELEVENLABS_API_KEY;

  // GET CREDITS
  if (req.method === 'POST' && req.body && req.body.action === 'get_credits') {
    const r = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': key }
    });
    const d = await r.json();
    return res.status(200).json(d);
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const { action, text, voice_id, model_id, audio_url, prompt, duration } = req.body || {};

    // 1. Listar voces
    if (action === 'get_voices') {
      const r = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey }
      });
      return res.status(200).json(await r.json());
    }

    // 2. Text to Speech
    if (action === 'text_to_speech') {
      const vid = voice_id || 'pNInz6obpgDQGcFmaJgB';
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
          model_id: model_id || 'eleven_multilingual_v2',
          voice_settings: { stability: 0.62, similarity_boost: 0.75 }
        })
      });
      const buffer = await r.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(Buffer.from(buffer));
    }

    // 3. Voice to Voice (cambiar voz de audio existente)
    if (action === 'voice_to_voice') {
      const vid = voice_id || 'pNInz6obpgDQGcFmaJgB';
      // Requiere archivo de audio — recibe base64
      const { audio_base64, audio_mime } = req.body;
      const audioBuffer = Buffer.from(audio_base64, 'base64');
      const FormData = require('form-data');
      const form = new FormData();
      form.append('audio', audioBuffer, { filename: 'input.mp3', contentType: audio_mime || 'audio/mpeg' });
      form.append('model_id', model_id || 'eleven_english_sts_v2');
      const r = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${vid}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
        body: form
      });
      const buffer = await r.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(Buffer.from(buffer));
    }

    // 4. Sound Effects Generator
    if (action === 'sound_effects') {
      const r = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: prompt || text,
          duration_seconds: duration || 5,
          prompt_influence: 0.3
        })
      });
      const buffer = await r.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(Buffer.from(buffer));
    }

    // 5. Speech to Text (transcripcion)
    if (action === 'speech_to_text') {
      const { audio_base64, audio_mime } = req.body;
      const audioBuffer = Buffer.from(audio_base64, 'base64');
      const FormData = require('form-data');
      const form = new FormData();
      form.append('audio', audioBuffer, { filename: 'input.mp3', contentType: audio_mime || 'audio/mpeg' });
      form.append('model_id', 'scribe_v1');
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, ...form.getHeaders() },
        body: form
      });
      return res.status(200).json(await r.json());
    }

    // 6. Generar imagen (ElevenLabs Image Generation)
    if (action === 'generate_image') {
      const r = await fetch('https://api.elevenlabs.io/v1/text-to-image', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt || text,
          aspect_ratio: req.body.aspect_ratio || '9:16',
          style: req.body.style || 'photorealistic'
        })
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // 7. Listar modelos disponibles
    if (action === 'get_models') {
      const r = await fetch('https://api.elevenlabs.io/v1/models', {
        headers: { 'xi-api-key': apiKey }
      });
      return res.status(200).json(await r.json());
    }

    res.status(400).json({ error: 'Action no reconocida: ' + action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
