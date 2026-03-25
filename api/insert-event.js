// /api/insert-event.js — Vercel serverless function
// Validates a Supabase auth token, then inserts event(s) into the events table
// using the service role key stored in Vercel env vars.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

// Required fields for an event
const REQUIRED_FIELDS = ['slug', 'title', 'date', 'event_date', 'city', 'category', 'source_name'];

// Allowed fields (prevents arbitrary data injection)
const ALLOWED_FIELDS = [
  'slug', 'title', 'date', 'event_date', 'end_date', 'time', 'time_notes',
  'venue', 'address', 'neighborhood', 'city', 'category', 'categories',
  'price', 'image_url', 'description', 'source_url', 'source_name',
  'ticket_url', 'performers', 'sold_out', 'editors_pick', 'featured',
  'related_articles', 'updated_at'
];

module.exports = async function handler(req, res) {
  // CORS headers for Claude/browser usage
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Check service role key is configured
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured in Vercel environment.' });
  }

  // ---- Validate the caller's auth token ----
  var authHeader = req.headers['authorization'] || '';
  var token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header. Provide Bearer <supabase_access_token>.' });
  }

  // Verify the token by calling Supabase's auth.getUser endpoint
  try {
    var userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey': SUPABASE_ANON_KEY
      }
    });

    if (!userResp.ok) {
      return res.status(401).json({ error: 'Invalid or expired auth token. Please re-export from the queue page with a fresh session.' });
    }

    var userData = await userResp.json();
    if (!userData.id) {
      return res.status(401).json({ error: 'Could not verify user from token.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Auth verification failed: ' + err.message });
  }

  // ---- Parse and validate the event payload ----
  var body = req.body;
  if (!body || !body.event) {
    return res.status(400).json({ error: 'Request body must contain an "event" object with event fields.' });
  }

  var event = body.event;

  // Strip any fields not in the allowed list
  var cleanEvent = {};
  for (var key in event) {
    if (ALLOWED_FIELDS.indexOf(key) !== -1 && event[key] !== undefined) {
      cleanEvent[key] = event[key];
    }
  }

  // Check required fields
  var missing = [];
  for (var i = 0; i < REQUIRED_FIELDS.length; i++) {
    if (!cleanEvent[REQUIRED_FIELDS[i]]) {
      missing.push(REQUIRED_FIELDS[i]);
    }
  }
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Missing required fields: ' + missing.join(', ') });
  }

  // Set updated_at
  cleanEvent.updated_at = new Date().toISOString();

  // ---- Insert into Supabase using the service role key ----
  try {
    var insertResp = await fetch(SUPABASE_URL + '/rest/v1/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(cleanEvent)
    });

    if (!insertResp.ok) {
      var errText = await insertResp.text();
      return res.status(insertResp.status).json({
        error: 'Supabase insert failed',
        details: errText
      });
    }

    var inserted = await insertResp.json();
    return res.status(201).json({
      success: true,
      message: 'Event inserted successfully',
      event: inserted[0] || inserted
    });
  } catch (err) {
    return res.status(500).json({ error: 'Insert failed: ' + err.message });
  }
};
