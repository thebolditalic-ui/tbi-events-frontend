// /api/track-page.js — Vercel serverless function
// Records a page-level impression for events.thebolditalic.com.
// Public; no auth required. Called by the events page after the
// IntersectionObserver fires (50% of <body> visible for ≥1 second).
//
// Body: { session_id, page_url, referrer }
//
// session_id is a random per-browser token kept in sessionStorage and
// not tied to any user identity. The browser dedupes per session
// before firing, so this endpoint just inserts what it gets — except
// for bot UAs and prefetch requests, which we drop server-side.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

// Same pattern list used by /api/banner-click. Anything matching these
// substrings is dropped without inserting, since it doesn't represent a
// human visit.
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

// Vercel auto-parses JSON, but sendBeacon can deliver text/plain — handle both.
function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });

  var body = parseBody(req);
  var sessionId = body.session_id;
  var pageUrl = body.page_url || '';
  var referrer = body.referrer || '';

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session_id' });
  }

  var ua = req.headers['user-agent'] || '';

  // Drop bots / prefetches silently. Returning 204 means the client
  // doesn't retry, and the row never gets written.
  if (isBotUA(ua) || isPrefetchRequest(req)) {
    return res.status(204).end();
  }

  try {
    var resp = await fetch(SUPABASE_URL + '/rest/v1/page_impressions', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        session_id: sessionId,
        page_url: pageUrl,
        referrer: referrer,
        user_agent: ua
      })
    });

    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(500).json({ error: 'Insert failed', details: errText });
    }

    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
