module.exports = async function handler(req, res) {
  // CORS — App 2 ([roar-creativos.vercel.app](https://roar-creativos.vercel.app)) la consume desde otro dominio
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({
      error: 'SUPABASE_URL o SUPABASE_ANON_KEY no configuradas en Vercel env'
    });
  }

  // ════════════════════════════════════════════════
  // POST — INSERT nuevo set
  // ════════════════════════════════════════════════
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const {
        ganador_sku,
        ganador_segmento,
        ganador_capa,
        ganador_hook,
        total_packs,
        packs_aprobados,
        payload
      } = body;

      if (!ganador_sku || !payload) {
        return res.status(400).json({ error: 'Faltan campos: ganador_sku o payload' });
      }

      const insertRow = {
        ganador_sku: ganador_sku,
        ganador_segmento: ganador_segmento || null,
        ganador_capa: ganador_capa || null,
        ganador_hook: ganador_hook || null,
        total_packs: total_packs || 0,
        packs_aprobados: packs_aprobados || 0,
        payload: payload,
        parser_version: '1.0',
        set_version: '1.0'
      };

      const r = await fetch(SUPABASE_URL + '/rest/v1/roar_sets', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(insertRow)
      });

      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({
          error: 'Supabase INSERT fallo',
          detail: txt
        });
      }

      const data = await r.json();
      const row = Array.isArray(data) ? data[0] : data;

      return res.status(200).json({
        id: row.id,
        created_at: row.created_at
      });

    } catch (err) {
      return res.status(500).json({
        error: 'Error procesando POST',
        detail: err.message
      });
    }
  }

  // ════════════════════════════════════════════════
  // GET — SELECT por id (consumido por App 2 en Fase C)
  // ════════════════════════════════════════════════
  if (req.method === 'GET') {
    try {
      const id = req.query && req.query.id;
      if (!id) {
        return res.status(400).json({ error: 'Falta query param: id' });
      }

      const r = await fetch(
        SUPABASE_URL + '/rest/v1/roar_sets?id=eq.' + encodeURIComponent(id) + '&select=*',
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY
          }
        }
      );

      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({
          error: 'Supabase SELECT fallo',
          detail: txt
        });
      }

      const rows = await r.json();
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Set no encontrado' });
      }

      // Marcar como consumido (fire-and-forget, no bloquea respuesta)
      fetch(
        SUPABASE_URL + '/rest/v1/roar_sets?id=eq.' + encodeURIComponent(id),
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            consumed_at: new Date().toISOString(),
            consumed_by_app: 'roar-creativos'
          })
        }
      ).catch(function(){});

      return res.status(200).json(rows[0]);

    } catch (err) {
      return res.status(500).json({
        error: 'Error procesando GET',
        detail: err.message
      });
    }
  }

  return res.status(405).json({ error: 'Metodo no permitido' });
};
