// /api/banner-click.js — Vercel serverless function
// GET /api/banner-click?id=<banner_uuid>
//
// Looks up the banner's destination_url, fires a click row into Supabase
// using the service role key (bypasses RLS), and 302-redirects the browser.
// The insert is fire-and-forget so the redirect isn't blocked by DB latency.
//
// Public; no auth required. The banner <a href> in the Ghost-injected script
// points here, so this endpoint must be reachable from any thebolditalic.com
// page.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Bot user-agent substrings — same family as the events frontend middleware.
// These are link-preview unfurlers, search crawlers, and common scripted clients.
// Anything matching is still redirected (URL behaves normally) but the click is
// not logged, since it doesn't represent human intent.
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
  if (!ua) return true; // empty UA is almost always a script
  ua = ua.toLowerCase();
  for (var i = 0; i < BOT_PATTERNS.length; i++) {
    if (ua.indexOf(BOT_PATTERNS[i]) !== -1) return true;
  }
  return false;
}

function isPrefetchRequest(req) {
  // Chrome speculation rules + <link rel=prefetch> + Safari prefetch
  var purpose = (req.headers['purpose'] || req.headers['sec-purpose'] || req.headers['x-purpose'] || '').toLowerCase();
  if (purpose.indexOf('prefetch') !== -1 || purpose.indexOf('prerender') !== -1) return true;
  // Firefox legacy
  if ((req.headers['x-moz'] || '').toLowerCase() === 'prefetch') return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  var id = req.query && req.query.id;
  if (!id) {
    return res.status(400).send('Missing id');
  }

  try {
    // 1. Fetch banner destination using anon key (RLS allows public SELECT).
    var lookupUrl = SUPABASE_URL
      + '/rest/v1/banners?select=destination_url&id=eq.'
      + encodeURIComponent(id)
      + '&limit=1';

    var lookupResp = await fetch(lookupUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    });

    if (!lookupResp.ok) {
      return res.status(500).send('Lookup failed');
    }

    var rows = await lookupResp.json();
    var banner = rows && rows[0];
    if (!banner || !banner.destination_url) {
      return res.status(404).send('Banner not found');
    }

    // 2. Log the click (fire-and-forget). Uses service role so the row gets
    //    written even though banner_clicks has no public-INSERT policy.
    //    BUT: skip the log entirely if this looks like a bot, link-preview
    //    unfurler, or browser prefetch — those aren't real human clicks and
    //    they were inflating CTR badly in early testing.
    var ua = req.headers['user-agent'] || '';
    var skipLog = isBotUA(ua) || isPrefetchRequest(req);

    if (SUPABASE_SERVICE_KEY && !skipLog) {
      var refererUrl = req.headers['referer'] || req.headers['referrer'] || '';
      var sessionId = (req.query && req.query.s) || null;

      // Fire and don't await — but capture the promise so Node doesn't drop it
      // before send. The .catch keeps an unhandled rejection from leaking.
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

    // 3. Redirect.
    res.setHeader('Location', banner.destination_url);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(302).end();
  } catch (err) {
    return res.status(500).send('Server error');
  }
};
