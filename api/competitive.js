module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const { keywords, country, limit } = req.body || {};

    const searchTerms = keywords || 'bolsas plastico';
    const countryCode = country || 'MX';
    const maxResults = limit || 20;

    const url = 'https://graph.facebook.com/v19.0/ads_archive?' +
      'access_token=' + token +
      '&fields=id,ad_creative_body,ad_creative_link_caption,ad_creative_link_description,ad_creative_link_title,ad_delivery_start_time,ad_snapshot_url,page_name,spend,impressions,currency,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions' +
      '&search_terms=' + encodeURIComponent(searchTerms) +
      '&ad_reached_countries=[%22' + countryCode + '%22]' +
      '&ad_active_status=ALL' +
      '&limit=' + maxResults + '&publisher_platforms=[%22facebook%22,%22instagram%22]';

    const r = await fetch(url);
    const d = await r.json();

    if(d.error) return res.status(200).json({ error: d.error.message, data: [] });

    const ads = (d.data || []).map(ad => ({
      id: ad.id,
      page: ad.page_name || 'Desconocido',
      body: ad.ad_creative_body || (ad.ad_creative_bodies && ad.ad_creative_bodies[0]) || '',
      title: ad.ad_creative_link_title || (ad.ad_creative_link_titles && ad.ad_creative_link_titles[0]) || '',
      description: ad.ad_creative_link_description || (ad.ad_creative_link_descriptions && ad.ad_creative_link_descriptions[0]) || '',
      since: ad.ad_delivery_start_time || '',
      snapshot: ad.ad_snapshot_url || '',
      spend: ad.spend || null,
      impressions: ad.impressions || null
    }));

    return res.status(200).json({ total: ads.length, data: ads });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
