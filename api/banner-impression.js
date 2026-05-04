// /api/banner-impression.js — Vercel serverless function
// Records a viewable impression (50% visible for ≥1 second, IAB Tier 2).
// Public; no auth required. Called by the Ghost-injected banner script
// after IntersectionObserver fires.
//
// Body: { banner_id, session_id, page_url }
// session_id is a random per-browser token kept in sessionStorage (not tied
// to user identity). Client-side dedup ensures one impression per session
// per banner — this endpoint just inserts what it gets.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

// Best-effort body parser — Vercel auto-parses application/json bodies, but
// if a client sends text/plain (e.g., navigator.sendBeacon without a Blob
// MIME wrapper), req.body comes through as a string. Handle both.
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
  var bannerId = body.banner_id;
  var sessionId = body.session_id;
  var pageUrl = body.page_url || '';

  if (!bannerId || !sessionId) {
    return res.status(400).json({ error: 'Missing banner_id or session_id' });
  }

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
      body: JSON.stringify({
        banner_id: bannerId,
        session_id: sessionId,
        page_url: pageUrl,
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
