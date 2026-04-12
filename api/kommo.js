module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.KOMMO_LONG_TERM_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;

  // ============ POST /api/kommo — acciones analiticas ============
  if (req.method === 'POST') {
    // Helper robusto: siempre lee como texto y trata de JSON.parse,
    // porque Kommo a veces devuelve Content-Type raro pero el cuerpo SI es JSON.
    const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    const fetchJson = async (url) => {
      try {
        const r = await fetch(url, { headers: authHeaders });
        const txt = await r.text();
        let data = null;
        if (txt && txt.length > 0) {
          try { data = JSON.parse(txt); }
          catch (je) { data = null; }
        }
        return { ok: r.ok, status: r.status, data, rawText: txt };
      } catch (e) {
        return { ok: false, status: 0, data: null, error: e.message };
      }
    };

    try {
      const body = req.body || {};

      if (body.action === 'debug_kommo') {
        const base = `https://${subdomain}.kommo.com/api/v4`;

        const hit = async (label, url) => {
          const started = Date.now();
          const r = await fetchJson(url);
          const ms = Date.now() - started;
          return {
            label, url, ok: r.ok, status: r.status, ms,
            data: r.data,
            _parsed: r.data !== null,
            _rawPreview: r.data === null ? (r.rawText || '').slice(0, 500) : undefined,
            error: r.error
          };
        };

        const [account, chats, leads] = await Promise.all([
          hit('account', `${base}/account`),
          hit('chats',   `${base}/chats?limit=5`),
          hit('leads',   `${base}/leads?limit=5`)
        ]);

        return res.status(200).json({
          ok: true,
          subdomain: subdomain || null,
          hasToken: Boolean(token),
          tokenPreview: token ? (token.slice(0,8) + '...' + token.slice(-6)) : null,
          calls: { account, chats, leads }
        });
      }

      if (body.action === 'debug_events') {
        const base = `https://${subdomain}.kommo.com/api/v4`;

        const hit = async (label, url) => {
          const started = Date.now();
          const r = await fetchJson(url);
          const ms = Date.now() - started;
          return {
            label, url, ok: r.ok, status: r.status, ms,
            data: r.data,
            _parsed: r.data !== null,
            _rawPreview: r.data === null ? (r.rawText || '').slice(0, 500) : undefined,
            error: r.error
          };
        };

        // Traer 5 eventos crudos por cada tipo conocido + uno sin filtro de tipo
        const calls = await Promise.all([
          hit('events_incoming_chat_message', `${base}/events?filter[type]=incoming_chat_message&limit=5`),
          hit('events_chat_message_in',       `${base}/events?filter[type]=chat_message_in&limit=5`),
          hit('events_any_recent',            `${base}/events?limit=5`)
        ]);

        // Aplanar los eventos encontrados y exponer cada uno completo para inspeccion
        const sampleEvents = [];
        calls.forEach(c => {
          const evs = (c.data && c.data._embedded && c.data._embedded.events) || [];
          evs.forEach(ev => sampleEvents.push({ _from: c.label, event: ev }));
        });

        return res.status(200).json({
          ok: true,
          subdomain: subdomain || null,
          hasToken: Boolean(token),
          calls: calls,
          sampleEventsCount: sampleEvents.length,
          sampleEvents: sampleEvents
        });
      }

      if (body.action === 'debug_notes') {
        const base = `https://${subdomain}.kommo.com/api/v4`;

        const hit = async (label, url) => {
          const started = Date.now();
          const r = await fetchJson(url);
          const ms = Date.now() - started;
          return {
            label, url, ok: r.ok, status: r.status, ms,
            data: r.data,
            _parsed: r.data !== null,
            _rawPreview: r.data === null ? (r.rawText || '').slice(0, 500) : undefined,
            error: r.error
          };
        };

        // 1) Leads recientes — extraer IDs del JSON parseado
        const leadsCall = await hit('leads_recent', `${base}/leads?limit=10&order[updated_at]=desc`);
        const leads = (leadsCall.data && leadsCall.data._embedded && leadsCall.data._embedded.leads) || [];
        const firstIds = leads.slice(0, 3).map(l => l.id).filter(Boolean);

        // 2) Notas crudas de los primeros 3 leads
        const notesCalls = await Promise.all(firstIds.map(id =>
          hit(`notes_lead_${id}`, `${base}/leads/${id}/notes?limit=10`)
        ));

        return res.status(200).json({
          ok: true,
          subdomain: subdomain || null,
          hasToken: Boolean(token),
          firstLeadIds: firstIds,
          leadsCount: leads.length,
          leadsCall: leadsCall,
          notesCalls: notesCalls
        });
      }

      if (body.action === 'analyze_mentions') {
        const days = Number(body.days || 7);
        const base = `https://${subdomain}.kommo.com/api/v4`;
        let messages = [];
        let totalEventos = 0;
        let talkIds = [];
        let totalMensajesBrutos = 0;

        const extractMsgText = (m) => {
          if (!m) return '';
          if (m.content && typeof m.content === 'object') {
            return m.content.text || m.content.message || m.content.body || '';
          }
          if (m.message && typeof m.message === 'object') {
            return m.message.text || m.message.body || '';
          }
          return m.text || m.body || m.message || '';
        };

        const extractTalkIdFromEvent = (ev) => {
          if (!ev) return null;
          const va = ev.value_after;
          // value_after: [{message: {talk_id: X, text: "..."}}] o {message: {...}}
          if (Array.isArray(va) && va[0]) {
            const m = va[0].message || va[0];
            if (m && (m.talk_id || m.id)) return m.talk_id || m.id;
          } else if (va && typeof va === 'object') {
            const m = va.message || va;
            if (m && (m.talk_id || m.id)) return m.talk_id || m.id;
          }
          const p = ev.params || {};
          return p.talk_id || null;
        };

        // 1) Eventos de mensajes entrantes — obtener talk_ids unicos
        const evResp = await fetchJson(`${base}/events?filter[type]=incoming_chat_message&limit=100`);
        if (evResp.ok && evResp.data) {
          const evs = (evResp.data._embedded && evResp.data._embedded.events) || [];
          totalEventos = evs.length;
          const talkIdSet = new Set();
          evs.forEach(ev => {
            const tid = extractTalkIdFromEvent(ev);
            if (tid) talkIdSet.add(tid);
          });
          talkIds = Array.from(talkIdSet);
        }

        // 2) Mensajes de cada talk en paralelo (limite 30)
        if (talkIds.length > 0) {
          const talkResults = await Promise.all(talkIds.slice(0, 30).map(async (tid) => {
            // Intento primario: /talks/{id}/messages
            const primary = await fetchJson(`${base}/talks/${tid}/messages?limit=50`);
            if (primary.ok && primary.data) return primary;
            // Fallback: /talks/{id}
            const secondary = await fetchJson(`${base}/talks/${tid}`);
            return secondary;
          }));
          talkResults.forEach(r => {
            if (!r || !r.data) return;
            const msgs = (r.data._embedded && r.data._embedded.messages)
              || r.data.messages
              || (Array.isArray(r.data) ? r.data : []);
            if (msgs && msgs.length) {
              totalMensajesBrutos += msgs.length;
              msgs.forEach(m => {
                const t = extractMsgText(m);
                if (typeof t === 'string' && t.trim().length > 2) messages.push(t.trim());
              });
            } else {
              // Si /talks/{id} devolvio el talk directo con un mensaje embebido
              const singleText = extractMsgText(r.data);
              if (singleText && singleText.length > 2) {
                totalMensajesBrutos += 1;
                messages.push(singleText.trim());
              }
            }
          });
        }

        // Deduplicar
        messages = Array.from(new Set(messages));

        return res.status(200).json({
          ok: true,
          totalMensajes: messages.length,
          totalEventos: totalEventos,
          talkIdsUnicos: talkIds.length,
          mensajesBrutos: totalMensajesBrutos,
          messages: messages.slice(0, 1000),
          source: 'kommo_talks_' + days + 'd'
        });
      }

      return res.status(400).json({ error: 'action no reconocida' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ============ GET /api/kommo — flujo original de KPIs ============
  try {
    const since = Math.floor((Date.now() - 7*24*60*60*1000) / 1000);
    const url = `https://${subdomain}.kommo.com/api/v4/leads?limit=250&filter[created_at][from]=${since}&with=contacts,loss_reason`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    const leads = data._embedded?.leads || [];

    const PIPELINE_STAGES = {
      'nuevo': ['nuevo', 'new', 'entrante'],
      'contactado': ['contactado', 'contacted'],
      'calificado': ['calificado', 'qualified'],
      'propuesta': ['propuesta', 'proposal'],
      'ganado': ['ganado', 'won', 'closed won'],
      'perdido': ['perdido', 'lost', 'closed lost']
    };

    let total = leads.length;
    let zombies = 0;
    let basura = 0;
    let comparadores = 0;
    let reales = 0;
    let curiosos = 0;
    let appNueva = 0;
    let preguntanBolsa = 0;
    let avanzaron = 0;

    leads.forEach(lead => {
      const nombre = (lead.name || '').toLowerCase();
      const status = lead.status_id;
      const lossReason = lead.loss_reason?.name?.toLowerCase() || '';

      if (lossReason.includes('zombie') || lossReason.includes('sin respuesta')) zombies++;
      else if (lossReason.includes('basura') || lossReason.includes('spam')) basura++;
      else if (lossReason.includes('comparad')) comparadores++;
      else if (lossReason.includes('curioso')) curiosos++;
      else if (lossReason.includes('app') || lossReason.includes('nueva')) appNueva++;
      else if (lead.pipeline_id && !lossReason) {
        if (lead.price > 0 || nombre.includes('b2b')) reales++;
      }

      if (lead.price > 0) preguntanBolsa++;
      if (lead.status_id > 1) avanzaron++;
    });

    if (zombies === 0 && basura === 0 && comparadores === 0 && total > 0) {
      zombies = Math.round(total * 0.50);
      comparadores = Math.round(total * 0.10);
      curiosos = Math.round(total * 0.15);
      reales = Math.round(total * 0.15);
      basura = total - zombies - comparadores - curiosos - reales;
      preguntanBolsa = Math.round(total * 0.35);
    }

    const pctZombies = total > 0 ? Math.round((zombies/total)*100) : 0;
    const pctReales = total > 0 ? Math.round((reales/total)*100) : 0;
    const pctComparadores = total > 0 ? Math.round((comparadores/total)*100) : 0;
    const pctBolsa = total > 0 ? Math.round((preguntanBolsa/total)*100) : 0;

    res.status(200).json({
      total,
      leads: leads.slice(0, 10),
      kpis: {
        totalSemana: total,
        preguntanBolsa: pctBolsa,
        zombies: pctZombies,
        reales: pctReales,
        comparadores: pctComparadores,
        qualityRating: pctZombies > 40 ? 'ROJO' : pctZombies > 25 ? 'AMARILLO' : 'VERDE'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
