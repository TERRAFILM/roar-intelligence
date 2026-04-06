module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const token = process.env.KOMMO_LONG_TERM_TOKEN;
    const subdomain = process.env.KOMMO_SUBDOMAIN;
    const { endpoint } = req.query;
    const url = `https://${subdomain}.kommo.com/api/v4/${endpoint || 'leads'}?limit=50`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
