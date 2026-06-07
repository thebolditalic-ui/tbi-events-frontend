// /api/track-page.js -- Vercel serverless function (MERGED analytics endpoint)
// One function now serves all three site-analytics writers, dispatched on ?t:
//   t=page        (default) -- page-view impression   -> page_impressions
//   t=event-click           -- event-card click       -> event_clicks
//   t=event-view            -- event detail-page view  -> event_views
// Original public paths are preserved via vercel.json rewrites:
//   /api/track-event-click -> /api/track-page?t=event-click
//   /api/track-event-view  -> /api/track-page?t=event-view
//   /api/track-page        -> (no ?t) defaults to page
// All three are POST, bot/prefetch-filtered, and insert via the anon key.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

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

async function insertRow(table, row) {
  return fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(row)
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  var t = (req.query && req.query.t) || 'page';
  var body = parseBody(req);
  var ua = req.headers['user-agent'] || '';

  // ---- t=page : page-level impression ----
  if (t === 'page') {
    var sessionId = body.session_id;
    if (!sessionId) return res.status(400).json({ error: 'Missing session_id' });
    if (isBotUA(ua) || isPrefetchRequest(req)) return res.status(204).end();
    try {
      var r1 = await insertRow('page_impressions', {
        session_id: sessionId,
        page_url: body.page_url || '',
        referrer: body.referrer || '',
        user_agent: ua
      });
      if (!r1.ok) { var e1 = await r1.text(); return res.status(500).json({ error: 'Insert failed', details: e1 }); }
      return res.status(204).end();
    } catch (err) { return res.status(500).json({ error: 'Server error: ' + err.message }); }
  }

  // ---- t=event-click : click on an event card ----
  if (t === 'event-click') {
    var eventSlug = body.event_slug;
    var placement = body.placement;
    if (!eventSlug) return res.status(400).json({ error: 'Missing event_slug' });
    if (placement !== 'featured' && placement !== 'list') {
      return res.status(400).json({ error: "placement must be 'featured' or 'list'" });
    }
    if (isBotUA(ua) || isPrefetchRequest(req)) return res.status(204).end();
    try {
      var r2 = await insertRow('event_clicks', {
        event_slug: eventSlug,
        event_url: body.event_url || '',
        placement: placement,
        session_id: body.session_id || null,
        page_url: body.page_url || '',
        user_agent: ua
      });
      if (!r2.ok) { var e2 = await r2.text(); return res.status(500).json({ error: 'Insert failed', details: e2 }); }
      return res.status(204).end();
    } catch (err) { return res.status(500).json({ error: 'Server error: ' + err.message }); }
  }

  // ---- t=event-view : detail-page view of an individual event ----
  if (t === 'event-view') {
    var evSlug = body.event_slug;
    var evSession = body.session_id;
    if (!evSlug || !evSession) return res.status(400).json({ error: 'Missing event_slug or session_id' });
    if (isBotUA(ua) || isPrefetchRequest(req)) return res.status(204).end();
    try {
      var r3 = await insertRow('event_views', {
        event_slug: evSlug,
        event_url: body.event_url || '',
        session_id: evSession,
        page_url: body.page_url || '',
        referrer: body.referrer || '',
        user_agent: ua
      });
      if (!r3.ok) { var e3 = await r3.text(); return res.status(500).json({ error: 'Insert failed', details: e3 }); }
      return res.status(204).end();
    } catch (err) { return res.status(500).json({ error: 'Server error: ' + err.message }); }
  }

  return res.status(400).json({ error: 'Unknown tracking type: ' + t });
};
