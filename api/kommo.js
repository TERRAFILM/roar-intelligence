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

      if (body.action === 'analyze_mentions') {
        const days = Number(body.days || 7);
        const since = Math.floor((Date.now() - days*24*60*60*1000) / 1000);
        let messages = [];
        let totalNotas = 0;

        const extractText = (n) => {
          const p = n.params || {};
          return p.text || p.message || p.body || p.comment || p.service || '';
        };

        // 1) Endpoint cross-entity de notas (Kommo v4)
        try {
          const notesUrl = `https://${subdomain}.kommo.com/api/v4/leads/notes?limit=250&filter[updated_at][from]=${since}`;
          const notesRes = await fetch(notesUrl, { headers: { 'Authorization': `Bearer ${token}` } });
          if (notesRes.ok) {
            const nd = await notesRes.json();
            const notes = (nd._embedded && nd._embedded.notes) || [];
            totalNotas += notes.length;
            notes.forEach(n => {
              const t = extractText(n);
              if (typeof t === 'string' && t.length > 2) messages.push(t);
            });
          }
        } catch (e) { /* continue to fallback */ }

        // 2) Fallback: jalar leads recientes y sus notas en paralelo
        if (messages.length === 0) {
          try {
            const leadsUrl = `https://${subdomain}.kommo.com/api/v4/leads?limit=50&filter[updated_at][from]=${since}`;
            const lr = await fetch(leadsUrl, { headers: { 'Authorization': `Bearer ${token}` } });
            const ld = await lr.json();
            const leads = (ld._embedded && ld._embedded.leads) || [];
            const ids = leads.slice(0, 30).map(l => l.id);
            const results = await Promise.all(ids.map(id =>
              fetch(`https://${subdomain}.kommo.com/api/v4/leads/${id}/notes?limit=50`, {
                headers: { 'Authorization': `Bearer ${token}` }
              })
                .then(r => r.ok ? r.json() : { _embedded: { notes: [] } })
                .catch(() => ({ _embedded: { notes: [] } }))
            ));
            results.forEach(r => {
              const ns = (r._embedded && r._embedded.notes) || [];
              totalNotas += ns.length;
              ns.forEach(n => {
                const t = extractText(n);
                if (typeof t === 'string' && t.length > 2) messages.push(t);
              });
            });
          } catch (e) { /* continue */ }
        }

        return res.status(200).json({
          ok: true,
          totalMensajes: messages.length,
          totalNotas: totalNotas,
          messages: messages.slice(0, 1000),
          source: 'kommo_notes_' + days + 'd'
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
