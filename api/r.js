// /api/r.js — Vercel serverless function
// The tbi.fyi redirect handler.
//
// Vercel routes every request to tbi.fyi (any path) here, with the
// path captured in ?slug=... by a host-conditional rewrite in
// vercel.json. This handler:
//
//   1. Looks up slug in the short_links table (lowercased)
//   2. If found and is_active, logs a row in short_link_clicks
//      (bots and prefetches are filtered out before logging,
//      same pattern as track-event-click), then 302 redirects
//      to destination_url.
//   3. If not found or inactive, 404s (or, if FALLBACK_URL is
//      set in env, 302s there).
//
// The Supabase RLS policy is "anon read" on short_links and
// "anon insert" on short_link_clicks, so the anon key is enough
// here — no service-role key needed.
//
// Note: tracking failures never block the redirect. If logging
// fails for any reason, we still send the user to their
// destination. Reliability of the user's click trumps stats.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

// Where to send tbi.fyi/ (apex hit) and unknown slugs.
// Override in Vercel env vars to point somewhere else.
const FALLBACK_URL = process.env.SHORT_LINK_FALLBACK_URL || 'https://www.thebolditalic.com';

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

// Lightweight non-cryptographic hash. Used only to roughly group
// repeat clicks from the same IP for stats, not to identify anyone.
function hashString(s) {
  if (!s) return '';
  var h = 5381;
  for (var i = 0; i < s.length; i++) {
    h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function getClientIp(req) {
  var fwd = req.headers['x-forwarded-for'] || '';
  if (fwd) {
    // x-forwarded-for is a comma-separated list; the leftmost is the original client
    var first = fwd.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers['x-real-ip'] || req.socket && req.socket.remoteAddress || '';
}

// Best-effort fire-and-forget click logging. Never throws.
async function logClick(slug, destination, req) {
  try {
    var ua = req.headers['user-agent'] || '';
    var referer = req.headers['referer'] || req.headers['referrer'] || '';
    var ipHash = hashString(getClientIp(req));

    await fetch(SUPABASE_URL + '/rest/v1/short_link_clicks', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        slug: slug,
        destination: destination,
        user_agent: ua,
        referer: referer,
        ip_hash: ipHash
      })
    });
  } catch (_) {
    // swallow — never block the redirect
  }
}

module.exports = async function handler(req, res) {
  // Only GET / HEAD make sense for a redirect endpoint.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end('Method not allowed');
  }

  // The slug is supplied by the rewrite. Vercel passes query params on req.query.
  var slug = (req.query && req.query.slug) || '';
  if (Array.isArray(slug)) slug = slug[0] || '';
  slug = String(slug).toLowerCase().trim();

  // Strip a trailing slash if Vercel ever passes one through.
  if (slug.length > 1 && slug.charAt(slug.length - 1) === '/') {
    slug = slug.slice(0, -1);
  }

  // Empty slug -> apex hit (someone typed just tbi.fyi).
  if (!slug) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.writeHead(302, { Location: FALLBACK_URL });
    return res.end();
  }

  // Defensive: only allow the same charset the DB CHECK enforces.
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
    res.writeHead(302, { Location: FALLBACK_URL });
    return res.end();
  }

  // Look the slug up. We use the REST API directly (no SDK) to keep
  // the cold start small.
  var lookupUrl = SUPABASE_URL
    + '/rest/v1/short_links'
    + '?slug=eq.' + encodeURIComponent(slug)
    + '&is_active=eq.true'
    + '&select=destination_url'
    + '&limit=1';

  var destination = '';
  try {
    var lookupResp = await fetch(lookupUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    });
    if (lookupResp.ok) {
      var rows = await lookupResp.json();
      if (rows && rows.length > 0 && rows[0].destination_url) {
        destination = rows[0].destination_url;
      }
    }
  } catch (_) {
    // fall through to fallback
  }

  if (!destination) {
    // Unknown slug -> 404 with a small HTML body so curl/etc see something
    // useful, but also Location to fallback so browsers gracefully redirect.
    res.writeHead(302, { Location: FALLBACK_URL });
    return res.end();
  }

  // Log the click unless it's a bot / prefetch. Don't await — let the
  // user's redirect happen in parallel.
  var ua = req.headers['user-agent'] || '';
  if (!isBotUA(ua) && !isPrefetchRequest(req)) {
    logClick(slug, destination, req);
  }

  // 302 because short links can change destinations; we don't want
  // browsers caching a permanent redirect to a stale target.
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: destination });
  return res.end();
};
