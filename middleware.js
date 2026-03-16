// Vercel Routing Middleware — detects bot/crawler requests for event pages
// and rewrites them to /api/og which serves proper Open Graph meta tags.
// Normal users get the SPA (index.html) as usual via vercel.json rewrites.

export const config = {
  matcher: ['/((?!_next|static|api|admin|robots\\.txt|favicon).*)'],
};

const BOT_PATTERNS = [
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'whatsapp',
  'discordbot',
  'googlebot',
  'bingbot',
  'imessage',
  'applebot',
  'petalbot',
  'embedly',
  'quora link preview',
  'showyoubot',
  'outbrain',
  'pinterest',
  'vkshare',
  'w3c_validator',
  'redditbot',
  'rogerbot',
  'summarlybot',
  'skypeuripreview',
];

// Matches event slug URLs like /my-event-2026-03-19/ or /my-event-2026-03-19
const EVENT_SLUG_RE = /^\/([a-z0-9][a-z0-9\-]+[a-z0-9])\/?$/;

export default function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Only intercept paths that look like event slugs
  if (path === '/' || path === '') return;

  const match = path.match(EVENT_SLUG_RE);
  if (!match) return;

  const slug = match[1];

  // Check user agent for bots
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  const isBot = BOT_PATTERNS.some(bot => ua.includes(bot));

  if (!isBot) return; // Normal users fall through to vercel.json rewrites → index.html

  // Rewrite bot request to the OG API route
  const ogUrl = new URL('/api/og?slug=' + encodeURIComponent(slug), request.url);
  return fetch(ogUrl);
}
