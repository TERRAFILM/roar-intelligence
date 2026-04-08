module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { keywords, country, limit } = req.body || {};
    const searchTerms = encodeURIComponent(keywords || 'bolsas plastico');
    const countryCode = country || 'MX';
    const maxResults = limit || 20;

    // Meta Ads Library publica — no requiere permisos especiales
    const url = 'https://www.facebook.com/ads/library/async/search_ads/?' +
      'q=' + searchTerms +
      '&count=' + maxResults +
      '&active_status=active' +
      '&ad_type=all' +
      '&country=' + countryCode +
      '&v=0&search_type=keyword_unordered&media_type=all';

    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-MX,es;q=0.9',
        'Referer': 'https://www.facebook.com/ads/library/',
        'X-FB-Friendly-Name': 'AdLibrarySearchV2Query'
      }
    });

    const text = await r.text();

    // Intentar parsear JSON
    let data;
    try {
      // Facebook a veces devuelve con prefijo de seguridad
      const cleaned = text.replace(/^for\s*\(;\s*;\s*\)\s*;/, '').trim();
      data = JSON.parse(cleaned);
    } catch(e) {
      // Si falla el parse, devolver URL directa para que el usuario consulte manualmente
      return res.status(200).json({
        total: 0,
        data: [],
        fallback: true,
        url: 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=' + countryCode + '&q=' + searchTerms + '&search_type=keyword_unordered&media_type=all',
        message: 'Meta Ads Library requiere acceso directo via navegador. Usa el enlace para ver los anuncios.'
      });
    }

    const ads = [];
    if(data && data.payload && data.payload.results) {
      data.payload.results.forEach(ad => {
        ads.push({
          id: ad.adArchiveID || ad.ad_id || '',
          page: ad.pageName || ad.page_name || 'Desconocido',
          body: (ad.snapshot && ad.snapshot.body && ad.snapshot.body.text) || ad.ad_creative_body || '',
          title: (ad.snapshot && ad.snapshot.title) || ad.ad_creative_link_title || '',
          description: (ad.snapshot && ad.snapshot.link_description) || '',
          since: ad.startDate || ad.ad_delivery_start_time || '',
          snapshot: 'https://www.facebook.com/ads/library/?id=' + (ad.adArchiveID || ad.ad_id || '')
        });
      });
    }

    if(ads.length === 0) {
      return res.status(200).json({
        total: 0,
        data: [],
        fallback: true,
        url: 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=' + countryCode + '&q=' + encodeURIComponent(keywords || 'bolsas plastico') + '&search_type=keyword_unordered&media_type=all',
        message: 'Abre el enlace para ver los anuncios activos en Meta Ads Library.'
      });
    }

    return res.status(200).json({ total: ads.length, data: ads });
  } catch(err) {
    const keywords = req.body && req.body.keywords ? req.body.keywords : 'bolsas plastico';
    const country = req.body && req.body.country ? req.body.country : 'MX';
    return res.status(200).json({
      total: 0,
      data: [],
      fallback: true,
      url: 'https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=' + country + '&q=' + encodeURIComponent(keywords) + '&search_type=keyword_unordered&media_type=all',
      message: 'Abre el enlace para ver los anuncios activos en Meta Ads Library.'
    });
  }
};
