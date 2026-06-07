// /api/banner-active.js -- Vercel serverless function (MERGED "banners" endpoint)
// One function now serves all three banner endpoints, dispatched on ?a:
//   a=active     (default) -- GET  -> up to 10 currently-live banners { banner, banners }
//   a=click                -- GET ?id=<uuid> -> log click (service key) + 302 redirect
//   a=impression           -- POST { banner_id, session_id, page_url } -> insert + 204
// Original public paths are preserved via vercel.json rewrites:
//   /api/banner-click      -> /api/banner-active?a=click
//   /api/banner-impression -> /api/banner-active?a=impression
//   /api/banner-active     -> (no ?a) defaults to active
// Behavior of each branch is identical to the original three functions.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

var BOT_PATTERNS = [
  'bot', 'crawler', 'spider', 'slurp',
  'curl', 'wget', 'python-requests', 'python-urllib', 'java/', 'go-http-client',
  'facebookexternalhit', 'facebot', 'twitterbot', 'linkedinbot', 'slackbot',
  'telegrambot', 'whatsapp', 'discordbot', 'imessage', 'applebot',
  'googlebot', 'bingbot', 'petalbot', 'duckduckbot',
  'embedly', 'pinterest', 'redditbot', 'rogerbot', 'showyoubot',
  'outbrain', 'quora link preview', 'skypeuripreview', 'vkshare',
  'w3c_validator', 'headlesschrome', 'phantomjs', 'puppeteer', 'playwright'
];

function isBotUA(ua) {
  if (!ua) return true;
  ua = ua.toLowerCase();
  for (var i = 0; i < BOT_PATTERNS.length; i++) {
    if (ua.indexOf(BOT_PATTERNS[i]) !== -1) return true;
  }
  return false;
}

function isPrefetchRequest(req) {
  var purpose = (req.headers['purpose'] || req.headers['sec-purpose'] || req.headers['x-purpose'] || '').toLowerCase();
  if (purpose.indexOf('prefetch') !== -1 || purpose.indexOf('prerender') !== -1) return true;
  if ((req.headers['x-moz'] || '').toLowerCase() === 'prefetch') return true;
  return false;
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return {};
}

// ---- a=active : up to ten currently-active banners (date-range in force now) ----
async function handleActive(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. Use GET.' });

  var nowIso = new Date().toISOString();
  var url = SUPABASE_URL + '/rest/v1/banners'
    + '?select=*'
    + '&is_active=eq.true'
    + '&or=(start_at.is.null,start_at.lte.' + encodeURIComponent(nowIso) + ')'
    + '&or=(end_at.is.null,end_at.gte.' + encodeURIComponent(nowIso) + ')'
    + '&order=placement_paragraph.asc,created_at.desc'
    + '&limit=10';

  try {
    var resp = await fetch(url, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    });
    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(500).json({ error: 'Supabase query failed', details: errText });
    }
    var rows = await resp.json();
    var banners = Array.isArray(rows) ? rows : [];
    return res.status(200).json({ banner: banners[0] || null, banners: banners });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}

// ---- a=click : lookup destination, fire-and-forget click log, 302 redirect ----
async function handleClick(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  var id = req.query && req.query.id;
  if (!id) return res.status(400).send('Missing id');

  try {
    var lookupUrl = SUPABASE_URL + '/rest/v1/banners?select=destination_url&id=eq.' + encodeURIComponent(id) + '&limit=1';
    var lookupResp = await fetch(lookupUrl, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
    });
    if (!lookupResp.ok) return res.status(500).send('Lookup failed');

    var rows = await lookupResp.json();
    var banner = rows && rows[0];
    if (!banner || !banner.destination_url) return res.status(404).send('Banner not found');

    var ua = req.headers['user-agent'] || '';
    var skipLog = isBotUA(ua) || isPrefetchRequest(req);
    if (SUPABASE_SERVICE_KEY && !skipLog) {
      var refererUrl = req.headers['referer'] || req.headers['referrer'] || '';
      var sessionId = (req.query && req.query.s) || null;
      fetch(SUPABASE_URL + '/rest/v1/banner_clicks', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          banner_id: id,
          session_id: sessionId,
          page_url: refererUrl,
          destination_url: banner.destination_url,
          user_agent: ua
        })
      }).catch(function () { /* swallow */ });
    }

    res.setHeader('Location', banner.destination_url);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(302).end();
  } catch (err) {
    return res.status(500).send('Server error');
  }
}

// ---- a=impression : record a viewable banner impression ----
async function handleImpression(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  var body = parseBody(req);
  var bannerId = body.banner_id;
  var sessionId = body.session_id;
  var pageUrl = body.page_url || '';
  if (!bannerId || !sessionId) return res.status(400).json({ error: 'Missing banner_id or session_id' });

  var ua = req.headers['user-agent'] || '';
  try {
    var resp = await fetch(SUPABASE_URL + '/rest/v1/banner_impressions', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ banner_id: bannerId, session_id: sessionId, page_url: pageUrl, user_agent: ua })
    });
    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(500).json({ error: 'Insert failed', details: errText });
    }
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}

module.exports = async function handler(req, res) {
  var a = (req.query && req.query.a) || 'active';
  if (a === 'click') return handleClick(req, res);
  if (a === 'impression') return handleImpression(req, res);
  return handleActive(req, res);
};
