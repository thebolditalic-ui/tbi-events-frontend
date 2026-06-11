// Vercel Edge Middleware — runs on every request before Vercel routing.
//
// Two responsibilities:
//
//   1. tbi.fyi short-link redirects.
//      Any request to tbi.fyi (or www.tbi.fyi) is treated as a short-link
//      lookup: take the URL path as the slug, look it up in Supabase, log
//      the click, and 302 to the destination.
//
//   2. Open Graph bot rewrites for events.thebolditalic.com (round 14).
//      A bot crawling /<event-slug> gets rewritten to /api/og?slug=...
//      so it sees proper OG meta tags. Real users fall through to the SPA.
//
// We branch on hostname first, then handle each surface separately. This is
// Edge Middleware (runs at the PoP), not a Serverless Function, so it does
// not count against the 12-function Hobby plan limit.
//
// Round-15 change: tbi.fyi short-link handling added here instead of as
// a separate /api/r serverless function, to stay under the Hobby plan
// function cap.

export const config = {
  // Match everything except true infrastructure paths. Both surfaces use
  // their own host/path checks inside the function to early-return when
  // there's nothing to do, so we can afford a broad matcher here.
  matcher: ['/((?!_next|static|favicon).*)'],
};


// ============================================================
// Short-link config
// ============================================================
const SHORT_LINK_HOSTS = new Set(['tbi.fyi', 'www.tbi.fyi']);
const SHORT_LINK_FALLBACK_URL = 'https://www.thebolditalic.com';

const SUPABASE_URL = 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Paths that should never be treated as short-link slugs even on tbi.fyi.
// These are admin / infra paths shared with the events.thebolditalic.com
// project. If someone types one on tbi.fyi we just bounce them to the
// fallback URL rather than serving the admin from the wrong host.
const ADMIN_PATH_PREFIXES = ['/api', '/admin', '/queue', '/banners', '/analytics', '/links', '/social', '/news_desk', '/dashboard', '/events'];
const ADMIN_EXACT_PATHS = new Set(['/robots.txt', '/sitemap.xml']);

// Standalone static pages (served by vercel.json rewrites) that are NOT event
// slugs — must skip the OG bot rewrite so crawlers get the real page.
const STATIC_PAGE_PATHS = new Set(['/disclosures', '/disclosures/']);

// Bot/crawler UA patterns. Used by both surfaces.
const BOT_PATTERNS = [
  'facebookexternalhit', 'facebot', 'twitterbot', 'linkedinbot', 'slackbot',
  'telegrambot', 'whatsapp', 'discordbot', 'googlebot', 'bingbot',
  'imessage', 'applebot', 'petalbot', 'embedly', 'quora link preview',
  'showyoubot', 'outbrain', 'pinterest', 'vkshare', 'w3c_validator',
  'redditbot', 'rogerbot', 'summarlybot', 'skypeuripreview',
  'bot', 'crawler', 'spider', 'slurp', 'curl', 'wget',
  'python-requests', 'python-urllib', 'java/', 'go-http-client',
  'duckduckbot', 'headlesschrome', 'phantomjs', 'puppeteer', 'playwright',
  'iframely', 'node-fetch', 'undici', 'okhttp', 'axios', 'python-httpx',
  'ghost', 'signal', 'metainspector', 'opengraph', 'http-link-preview', 'guzzlehttp'
];

// Used by the OG bot rewrite (event-slug-shaped paths only).
const EVENT_SLUG_RE = /^\/([a-z0-9][a-z0-9\-]+[a-z0-9])\/?$/;


// ============================================================
// Helpers
// ============================================================
function isBotUA(ua) {
  if (!ua) return true;
  ua = ua.toLowerCase();
  for (const p of BOT_PATTERNS) {
    if (ua.includes(p)) return true;
  }
  return false;
}

function isPrefetchRequest(request) {
  const purpose = (
    request.headers.get('purpose') ||
    request.headers.get('sec-purpose') ||
    request.headers.get('x-purpose') ||
    ''
  ).toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('prerender')) return true;
  if ((request.headers.get('x-moz') || '').toLowerCase() === 'prefetch') return true;
  return false;
}

// Lightweight non-cryptographic hash (djb2). Used to roughly group repeat
// clicks from the same IP for stats; never reversed back to an IP.
function hashString(s) {
  if (!s) return '';
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function getClientIp(request) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  if (fwd) {
    const first = fwd.split(',')[0].trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') || '';
}


// ============================================================
// Short-link surface (tbi.fyi)
// ============================================================
async function handleShortLink(request, url) {
  // Strip leading/trailing slashes, lowercase, then validate against
  // the same regex the database CHECK constraint uses.
  let slug = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();

  // tbi.fyi/  -> apex hit, send to fallback
  if (!slug) {
    return Response.redirect(SHORT_LINK_FALLBACK_URL, 302);
  }

  // Reserved admin paths -> never look these up as slugs, just bounce.
  const pathLower = '/' + slug;
  if (ADMIN_EXACT_PATHS.has(pathLower)) {
    return Response.redirect(SHORT_LINK_FALLBACK_URL, 302);
  }
  for (const pre of ADMIN_PATH_PREFIXES) {
    if (pathLower === pre || pathLower.startsWith(pre + '/')) {
      return Response.redirect(SHORT_LINK_FALLBACK_URL, 302);
    }
  }

  // Defensive: only valid-shaped slugs are even queried.
  if (!SLUG_RE.test(slug)) {
    return Response.redirect(SHORT_LINK_FALLBACK_URL, 302);
  }

  // ---- Look up the slug ----
  let destination = '';
  try {
    const lookupUrl = SUPABASE_URL
      + '/rest/v1/short_links'
      + '?slug=eq.' + encodeURIComponent(slug)
      + '&is_active=eq.true'
      + '&select=destination_url'
      + '&limit=1';

    const resp = await fetch(lookupUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      },
    });
    if (resp.ok) {
      const rows = await resp.json();
      if (rows && rows.length > 0 && rows[0].destination_url) {
        destination = rows[0].destination_url;
      }
    }
  } catch (_) {
    // fall through to fallback
  }

  if (!destination) {
    return Response.redirect(SHORT_LINK_FALLBACK_URL, 302);
  }

  // ---- Log the click (skip bots / prefetches) ----
  // We await the insert so the row is durable before we redirect. Adds
  // ~30-60 ms but means stats are reliable. If Supabase is slow or down,
  // we still redirect because of the catch — the user always wins over
  // analytics.
  const ua = request.headers.get('user-agent') || '';
  if (!isBotUA(ua) && !isPrefetchRequest(request)) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/short_link_clicks', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          slug: slug,
          destination: destination,
          user_agent: ua,
          referer: request.headers.get('referer') || '',
          ip_hash: hashString(getClientIp(request)),
        }),
      });
    } catch (_) {
      // never block the redirect on a logging failure
    }
  }

  return Response.redirect(destination, 302);
}


// ============================================================
// OG bot surface (events.thebolditalic.com — round 14 behavior)
// ============================================================
function handleEventsHost(request, url) {
  const path = url.pathname;

  // Skip admin / infra paths so a Googlebot request to /admin or /api
  // never accidentally falls into the event-slug regex.
  for (const pre of ADMIN_PATH_PREFIXES) {
    if (path === pre || path.startsWith(pre + '/')) return;
  }
  if (ADMIN_EXACT_PATHS.has(path)) return;
  if (STATIC_PAGE_PATHS.has(path)) return;
  if (path === '/' || path === '') return;

  const match = path.match(EVENT_SLUG_RE);
  if (!match) return;
  const slug = match[1];

  // Only bots get the OG rewrite; humans fall through to the SPA.
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  const isBot = BOT_PATTERNS.some(b => ua.includes(b));
  if (!isBot) return;

  const ogUrl = new URL('/api/og?slug=' + encodeURIComponent(slug), request.url);
  return fetch(ogUrl);
}


// ============================================================
// Entry point
// ============================================================
export default async function middleware(request) {
  const url = new URL(request.url);
  const host = (request.headers.get('host') || '').toLowerCase();

  // admin.thebolditalic.com root -> the dashboard. Middleware runs BEFORE the
  // filesystem, which otherwise serves index.html for "/" and ignores rewrites.
  if (host === 'admin.thebolditalic.com' && (url.pathname === '/' || url.pathname === '')) {
    return new Response(null, {
      headers: { 'x-middleware-rewrite': new URL('/dashboard.html', request.url).toString() },
    });
  }

  if (SHORT_LINK_HOSTS.has(host)) {
    return await handleShortLink(request, url);
  }

  // Anything else (events.thebolditalic.com, vercel preview URLs, etc.)
  // gets the existing OG bot logic. Returning undefined falls through to
  // vercel.json rewrites and serves the SPA as normal.
  return handleEventsHost(request, url);
}
