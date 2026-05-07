// /api/banner-active.js — Vercel serverless function
// Returns up to ten currently-active banners.
// Public; no auth required. Called by:
//   - The Ghost-injected banner script on thebolditalic.com
//   - The banners.html admin (to show "currently live" status)
//
// "Active" here means the date-range schedule is in force right now:
//   is_active = true
//   AND (start_at IS NULL OR start_at <= now)
//   AND (end_at   IS NULL OR end_at   >= now)
//
// Time-of-day filtering (tod_start / tod_end) is intentionally NOT applied
// server-side — clients filter by current Pacific time so the edge cache
// can stay 60s without serving stale time-of-day windows. The Ghost
// script and the banners.html admin both filter on tod_start / tod_end
// using the reader's / admin's view of "now in Pacific".
//
// Ordered: placement_paragraph ASC, then created_at DESC. Up to 10 rows
// — gives clients plenty of room to support multiple slots × multiple
// time-of-day windows without re-deploying this endpoint.
//
// Response shape:
//   { banner: <first or null>, banners: [<0..10 rows>] }
// The "banner" key (singular) is kept for backward compat with old Ghost
// scripts. Newer clients should read "banners" (plural).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache at the edge for 60s with SWR — banner changes propagate within ~60-120s.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. Use GET.' });

  var nowIso = new Date().toISOString();

  // PostgREST: multiple top-level filters AND together. Each `or=` group is
  // its own OR. So this is: is_active=true AND (start_at IS NULL OR start_at <= now)
  // AND (end_at IS NULL OR end_at >= now). Up to 10 rows.
  var url = SUPABASE_URL + '/rest/v1/banners'
    + '?select=*'
    + '&is_active=eq.true'
    + '&or=(start_at.is.null,start_at.lte.' + encodeURIComponent(nowIso) + ')'
    + '&or=(end_at.is.null,end_at.gte.' + encodeURIComponent(nowIso) + ')'
    + '&order=placement_paragraph.asc,created_at.desc'
    + '&limit=10';

  try {
    var resp = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    });

    if (!resp.ok) {
      var errText = await resp.text();
      return res.status(500).json({ error: 'Supabase query failed', details: errText });
    }

    var rows = await resp.json();
    var banners = Array.isArray(rows) ? rows : [];
    return res.status(200).json({
      banner: banners[0] || null,   // backward-compat
      banners: banners              // canonical going forward
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
