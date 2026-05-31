// api/kommo-webhook.js
// Webhook receptor de mensajes WA desde Kommo.
// Captura cada mensaje ENTRANTE, lo guarda en Supabase (tabla mensajes_leads)
// y mantiene contadores de keywords en memoria caliente para diagnostico rapido via GET.

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
      se_rompe_truena: 0, doble_bolsa: 0, no_soporta_peso: 0,
      calor_revienta: 0, picos_perforan: 0, frio_congelador: 0,
      solo_precio: 0, total_mensajes_analizados: 0,
      total_guardados_supabase: 0, ultimo_error_supabase: null,
      ultimo_mensaje: null, iniciado: new Date().toISOString()
    };
  }
  return global._roarWebhookCounters;
}

function toFlatParams(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const hasKommoKeys = Object.keys(body).some(k => k.indexOf('message[add]') === 0 || k.indexOf('account[') === 0);
    if (hasKommoKeys) return body;
  }
  if (typeof body === 'string' && body.length) {
    const flat = {};
    body.split('&').forEach(pair => {
      const idx = pair.indexOf('=');
      if (idx === -1) return;
      const k = decodeURIComponent(pair.slice(0, idx).replace(/\+/g, ' '));
      const v = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
      flat[k] = v;
    });
    return flat;
  }
  return body || {};
}

function parseKommoMessage(flat) {
  const get = (k) => (flat[k] !== undefined ? flat[k] : null);
  const texto = get('message[add][0][text]');
  if (!texto) return null;
  return {
    texto: texto,
    chat_id:     get('message[add][0][chat_id]'),
    contact_id:  get('message[add][0][contact_id]') ? Number(get('message[add][0][contact_id]')) : null,
    entity_id:   get('message[add][0][entity_id]') ? Number(get('message[add][0][entity_id]')) : null,
    entity_type: get('message[add][0][entity_type]'),
    subdomain:   get('account[subdomain]')
  };
}

async function guardarEnSupabase(msg, rawFlat, counters) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    counters.ultimo_error_supabase = 'env no configuradas';
    return;
  }
  const insertRow = {
    lead_id:     msg.entity_type === 'lead' ? msg.entity_id : null,
    contact_id:  msg.contact_id,
    chat_id:     msg.chat_id,
    texto:       msg.texto,
    autor:       'lead',
    entity_type: msg.entity_type,
    subdomain:   msg.subdomain,
    raw:         rawFlat
  };
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/mensajes_leads', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(insertRow)
    });
    if (!r.ok) {
      counters.ultimo_error_supabase = 'HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200);
    } else {
      counters.total_guardados_supabase += 1;
      counters.ultimo_error_supabase = null;
    }
  } catch (err) {
    counters.ultimo_error_supabase = err.message;
  }
}

function detectKeywords(text, counters) {
  const detectados = [];
  const lower = (text || '').toLowerCase();
  Object.keys(KEYWORDS).forEach(cat => {
    if (KEYWORDS[cat].some(kw => lower.indexOf(kw.toLowerCase()) !== -1)) {
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
  if (req.method === 'OPTIONS') return res.status(200).end();

  const counters = initCounters();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, source: 'kommo-webhook', counters });
  }

  if (req.method === 'POST') {
    try {
      const flat = toFlatParams(req.body);
      const msg = parseKommoMessage(flat);

      if (!msg) {
        counters.total_mensajes_analizados += 1;
        return res.status(200).json({ ok: true, guardado: false, motivo: 'sin texto de mensaje' });
      }

      const detectados = detectKeywords(msg.texto, counters);
      counters.total_mensajes_analizados += 1;
      counters.ultimo_mensaje = msg.texto.slice(0, 500);

      await guardarEnSupabase(msg, flat, counters);

      return res.status(200).json({
        ok: true,
        guardado: true,
        detectados,
        total: counters.total_mensajes_analizados,
        guardados: counters.total_guardados_supabase
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'method not allowed' });
}
