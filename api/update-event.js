// /api/update-event.js — Vercel serverless function
// Validates a Supabase auth token, then updates an event by slug
// using the service role key stored in Vercel env vars.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

// Allowed fields for update (same as insert, minus slug which is the identifier)
const ALLOWED_FIELDS = [
  'title', 'date', 'event_date', 'end_date', 'time', 'time_notes',
  'venue', 'address', 'neighborhood', 'city', 'category', 'categories',
  'price', 'image_url', 'description', 'source_url', 'source_name',
  'ticket_url', 'performers', 'sold_out', 'editors_pick', 'featured', 'sponsored',
  'related_articles', 'updated_at'
];

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed. Use PATCH.' });
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

  // ---- Parse the update payload ----
  var body = req.body;
  if (!body || !body.slug) {
    return res.status(400).json({ error: 'Request body must contain a "slug" string to identify the event.' });
  }

  var slug = body.slug;
  var fields = body.fields || body;

  // Strip disallowed fields
  var cleanFields = {};
  for (var key in fields) {
    if (ALLOWED_FIELDS.indexOf(key) !== -1 && fields[key] !== undefined) {
      cleanFields[key] = fields[key];
    }
  }

  if (Object.keys(cleanFields).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  cleanFields.updated_at = new Date().toISOString();

  // ---- Update in Supabase using the service role key ----
  try {
    var updateResp = await fetch(
      SUPABASE_URL + '/rest/v1/events?slug=eq.' + encodeURIComponent(slug),
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(cleanFields)
      }
    );

    if (!updateResp.ok) {
      var errText = await updateResp.text();
      return res.status(updateResp.status).json({
        error: 'Supabase update failed',
        details: errText
      });
    }

    var updated = await updateResp.json();
    if (!updated || updated.length === 0) {
      return res.status(404).json({ error: 'No event found with slug: ' + slug });
    }

    return res.status(200).json({
      success: true,
      message: 'Event updated successfully',
      event: updated[0] || updated
    });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed: ' + err.message });
  }
};
