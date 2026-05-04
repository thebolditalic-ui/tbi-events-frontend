// /api/banner-active.js — Vercel serverless function
// Returns the currently-active banner (or null if none).
// Public; no auth required. Called by:
//   - The Ghost-injected banner script on thebolditalic.com
//   - The banners.html admin (to show "currently live" status)
//
// Active banner = is_active=true AND start_at IS NULL or in the past
//                 AND end_at IS NULL or in the future. Newest first; one row.

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
  // AND (end_at IS NULL OR end_at >= now). Newest first, one row.
  var url = SUPABASE_URL + '/rest/v1/banners'
    + '?select=*'
    + '&is_active=eq.true'
    + '&or=(start_at.is.null,start_at.lte.' + encodeURIComponent(nowIso) + ')'
    + '&or=(end_at.is.null,end_at.gte.' + encodeURIComponent(nowIso) + ')'
    + '&order=created_at.desc'
    + '&limit=1';

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
    return res.status(200).json({ banner: (rows && rows[0]) || null });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
