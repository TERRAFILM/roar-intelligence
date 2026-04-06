module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const adAccountId = process.env.META_AD_ACCOUNT_ID;
    const fields = 'name,status,effective_status,daily_budget,lifetime_budget,insights{spend,impressions,reach,clicks,ctr,cpc,cpp,actions,cost_per_action_type}';
    const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/ads?fields=${fields}&access_token=${token}&limit=50`;
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
