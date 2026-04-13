// Webhook receptor de mensajes WA desde Kommo.
// Captura texto entrante, detecta keywords de problema y mantiene contadores
// en memoria caliente del runtime Vercel. No persiste entre cold starts.

const KEYWORDS = {
  se_rompe_truena:  ['se rompe', 'se truena', 'truena', 'revienta', 'se desfonda', 'desfonda'],
  doble_bolsa:      ['doble bolsa', 'pongo doble', 'ponemos doble', 'doble la bolsa'],
  no_soporta_peso:  ['no soporta', 'no aguanta', 'se cae', 'muy ligera', 'muy delgada'],
  calor_revienta:   ['calor', 'caliente', 'se derrite', 'temperatura alta'],
  picos_perforan:   ['picos', 'perfora', 'perforan', 'los huesos', 'espinas'],
  frio_congelador:  ['congelador', 'hielo', 'congela', 'frío', 'fría'],
  solo_precio:      ['cuánto cuesta', 'cuanto cuesta', 'precio', 'más barata', 'más económica']
};

function initCounters() {
  if (!global._roarWebhookCounters) {
    global._roarWebhookCounters = {
      se_rompe_truena: 0,
      doble_bolsa: 0,
      no_soporta_peso: 0,
      calor_revienta: 0,
      picos_perforan: 0,
      frio_congelador: 0,
      solo_precio: 0,
      total_mensajes_analizados: 0,
      ultimo_mensaje: null,
      iniciado: new Date().toISOString()
    };
  }
  return global._roarWebhookCounters;
}

function extractText(body) {
  if (!body) return '';
  const candidates = [];

  if (body.message && typeof body.message === 'object' && body.message.text) candidates.push(body.message.text);
  if (body.payload && body.payload.message && body.payload.message.text) candidates.push(body.payload.message.text);
  if (body.payload && body.payload.body) candidates.push(body.payload.body);
  if (body.incoming_chat_message && body.incoming_chat_message.text) candidates.push(body.incoming_chat_message.text);
  if (typeof body.text === 'string') candidates.push(body.text);
  if (typeof body.body === 'string') candidates.push(body.body);
  if (typeof body.content === 'string') candidates.push(body.content);

  if (Array.isArray(body.messages)) {
    body.messages.forEach(m => {
      if (!m) return;
      if (typeof m.text === 'string') candidates.push(m.text);
      else if (typeof m.body === 'string') candidates.push(m.body);
    });
  }

  let text = candidates.filter(Boolean).join(' ').trim();
  if (!text) text = JSON.stringify(body);
  return text.toLowerCase();
}

function detectKeywords(text, counters) {
  const detectados = [];
  Object.keys(KEYWORDS).forEach(cat => {
    const hit = KEYWORDS[cat].some(kw => text.indexOf(kw.toLowerCase()) !== -1);
    if (hit) {
      counters[cat] = (counters[cat] || 0) + 1;
      detectados.push(cat);
    }
  });
  return detectados;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Kommo-Signature');
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const counters = initCounters();

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      source: 'kommo-webhook',
      counters
    });
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const text = extractText(body);
      const detectados = detectKeywords(text, counters);
      counters.total_mensajes_analizados += 1;
      counters.ultimo_mensaje = text.slice(0, 500);
      return res.status(200).json({
        ok: true,
        detectados,
        total: counters.total_mensajes_analizados
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'method not allowed' });
}
