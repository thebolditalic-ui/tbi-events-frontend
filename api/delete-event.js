// /api/delete-event.js — Vercel serverless function
// Validates a Supabase auth token, then deletes event(s) by slug or source_name
// using the service role key stored in Vercel env vars.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed. Use DELETE.' });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured in Vercel environment.' });
  }

  // ---- Validate the caller's auth token ----
  var authHeader = req.headers['authorization'] || '';
  var token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header. Provide Bearer <supabase_access_token>.' });
  }

  try {
    var userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey': SUPABASE_ANON_KEY
      }
    });

    if (!userResp.ok) {
      return res.status(401).json({ error: 'Invalid or expired auth token.' });
    }

    var userData = await userResp.json();
    if (!userData.id) {
      return res.status(401).json({ error: 'Could not verify user from token.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Auth verification failed: ' + err.message });
  }

  // ---- Parse the delete payload ----
  var body = req.body;

  // Two modes: delete by slug, or delete by source_name
  if (!body || (!body.slug && !body.source_name)) {
    return res.status(400).json({ error: 'Request body must contain a "slug" or "source_name" to identify event(s) to delete.' });
  }

  var filterParam;
  if (body.slug) {
    filterParam = 'slug=eq.' + encodeURIComponent(body.slug);
  } else {
    filterParam = 'source_name=eq.' + encodeURIComponent(body.source_name);
  }

  // ---- Delete from Supabase using the service role key ----
  try {
    var deleteResp = await fetch(
      SUPABASE_URL + '/rest/v1/events?' + filterParam,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Prefer': 'return=representation'
        }
      }
    );

    if (!deleteResp.ok) {
      var errText = await deleteResp.text();
      return res.status(deleteResp.status).json({
        error: 'Supabase delete failed',
        details: errText
      });
    }

    var deleted = await deleteResp.json();
    return res.status(200).json({
      success: true,
      message: 'Deleted ' + deleted.length + ' event(s)',
      deleted: deleted
    });
  } catch (err) {
    return res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
};
