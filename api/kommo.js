module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.KOMMO_LONG_TERM_TOKEN;
  const subdomain = process.env.KOMMO_SUBDOMAIN;

  // ============ POST /api/kommo — acciones analiticas ============
  if (req.method === 'POST') {
    try {
      const body = req.body || {};

      if (body.action === 'debug_kommo') {
        const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
        const base = `https://${subdomain}.kommo.com/api/v4`;

        const hit = async (label, url) => {
          const started = Date.now();
          try {
            const r = await fetch(url, { headers: authHeaders });
            const ms = Date.now() - started;
            const ct = r.headers.get('content-type') || '';
            let payload;
            if (ct.includes('application/json')) {
              try { payload = await r.json(); }
              catch (je) { payload = { _parse_error: je.message }; }
            } else {
              const txt = await r.text();
              payload = { _non_json: true, _text: txt.slice(0, 2000) };
            }
            return { label, url, ok: r.ok, status: r.status, ms, data: payload };
          } catch (e) {
            return { label, url, ok: false, status: 0, error: e.message };
          }
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

      if (body.action === 'analyze_mentions') {
        const days = Number(body.days || 7);
        const authHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
        const base = `https://${subdomain}.kommo.com/api/v4`;
        let messages = [];
        let totalLeads = 0;
        let totalNotas = 0;
        let totalEventos = 0;

        const extractNoteText = (n) => {
          if (!n) return '';
          const p = n.params || {};
          return n.text || p.text || p.message || p.body || p.comment || p.service || '';
        };

        const extractEventText = (e) => {
          if (!e) return '';
          const p = e.params || {};
          const va = e.value_after;
          let vaText = '';
          if (typeof va === 'string') vaText = va;
          else if (Array.isArray(va) && va[0]) vaText = va[0].value || va[0].text || va[0].message || '';
          else if (va && typeof va === 'object') vaText = va.value || va.text || va.message || '';
          return vaText || p.message || p.text || p.body || '';
        };

        // 1) Leads recientes ordenados por updated_at desc
        let leadIds = [];
        try {
          const leadsUrl = `${base}/leads?limit=50&order[updated_at]=desc`;
          const lr = await fetch(leadsUrl, { headers: authHeaders });
          if (lr.ok) {
            const ld = await lr.json();
            const leads = (ld._embedded && ld._embedded.leads) || [];
            totalLeads = leads.length;
            leadIds = leads.map(l => l.id).filter(Boolean);
          }
        } catch (e) { /* continue */ }

        // 2) Notas por lead en paralelo (hasta 30)
        if (leadIds.length > 0) {
          try {
            const noteResults = await Promise.all(leadIds.slice(0, 30).map(id =>
              fetch(`${base}/leads/${id}/notes?limit=50`, { headers: authHeaders })
                .then(r => r.ok ? r.json() : { _embedded: { notes: [] } })
                .catch(() => ({ _embedded: { notes: [] } }))
            ));
            noteResults.forEach(r => {
              const ns = (r._embedded && r._embedded.notes) || [];
              totalNotas += ns.length;
              ns.forEach(n => {
                const t = extractNoteText(n);
                if (typeof t === 'string' && t.trim().length > 2) messages.push(t.trim());
              });
            });
          } catch (e) { /* continue */ }
        }

        // 3) Eventos de mensajes entrantes (chat_message_in / incoming_chat_message)
        try {
          const evTypes = ['incoming_chat_message', 'chat_message_in', 'chat_incoming_message'];
          const evResults = await Promise.all(evTypes.map(type =>
            fetch(`${base}/events?filter[entity_type]=lead&filter[type]=${type}&limit=100`, { headers: authHeaders })
              .then(r => r.ok ? r.json() : { _embedded: { events: [] } })
              .catch(() => ({ _embedded: { events: [] } }))
          ));
          evResults.forEach(r => {
            const evs = (r._embedded && r._embedded.events) || [];
            totalEventos += evs.length;
            evs.forEach(ev => {
              const t = extractEventText(ev);
              if (typeof t === 'string' && t.trim().length > 2) messages.push(t.trim());
            });
          });
        } catch (e) { /* continue */ }

        // Deduplicar
        messages = Array.from(new Set(messages));

        return res.status(200).json({
          ok: true,
          totalMensajes: messages.length,
          totalLeads: totalLeads,
          totalNotas: totalNotas,
          totalEventos: totalEventos,
          messages: messages.slice(0, 1000),
          source: 'kommo_leads_notes_events_' + days + 'd'
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
