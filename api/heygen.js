module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.HEYGEN_API_KEY;

  try {
    const { action } = req.body || {};

    // 1. Listar avatares disponibles
    if (action === 'list_avatars') {
      const r = await fetch('https://api.heygen.com/v2/avatars', {
        headers: { 'X-Api-Key': apiKey }
      });
      const d = await r.json();
      return res.status(200).json(d);
    }

    // 2. Listar voces disponibles
    if (action === 'list_voices') {
      const r = await fetch('https://api.heygen.com/v2/voices', {
        headers: { 'X-Api-Key': apiKey }
      });
      const d = await r.json();
      return res.status(200).json(d);
    }

    // 3. Generar video con avatar + script
    if (action === 'generate_video') {
      const { script, avatar_id, voice_id } = req.body;
      if (!script) return res.status(400).json({ error: 'Script requerido' });

      const payload = {
        video_inputs: [{
          character: {
            type: 'avatar',
            avatar_id: avatar_id || 'Daisy-inskirt-20220818',
            avatar_style: 'normal'
          },
          voice: {
            type: 'text',
            input_text: script,
            voice_id: voice_id || 'es-MX-JorgeNeural',
            speed: 1.0
          }
        }],
        dimension: { width: 1080, height: 1920 },
        aspect_ratio: '9:16'
      };

      const r = await fetch('https://api.heygen.com/v2/video/generate', {
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      return res.status(200).json(d);
    }

    // 4. Verificar estado de video
    if (action === 'video_status') {
      const { video_id } = req.body;
      const r = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${video_id}`, {
        headers: { 'X-Api-Key': apiKey }
      });
      const d = await r.json();
      return res.status(200).json(d);
    }

    return res.status(400).json({ error: 'Action no reconocida' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
