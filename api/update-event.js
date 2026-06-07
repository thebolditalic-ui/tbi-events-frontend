// /api/update-event.js -- Vercel serverless function (MERGED events CRUD endpoint)
// One function now serves all three event-CRUD endpoints, dispatched on HTTP method:
//   POST   -> insert event(s)   (body { event })
//   PATCH  -> update by slug     (body { slug, fields|... })
//   DELETE -> delete by slug or source_name
// Original public paths are preserved via vercel.json rewrites:
//   /api/insert-event -> /api/update-event   (POST)
//   /api/delete-event -> /api/update-event   (DELETE)
//   /api/update-event -> (PATCH, unchanged)
// All methods first validate the caller's Supabase auth token, then act with the
// service role key. Behavior of each branch is identical to the original three.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

// Required fields for an insert
const REQUIRED_FIELDS = ['slug', 'title', 'date', 'event_date', 'city', 'category', 'source_name'];

// Allowed fields for insert (prevents arbitrary data injection)
const ALLOWED_FIELDS_INSERT = [
  'slug', 'title', 'date', 'event_date', 'end_date', 'time', 'time_notes',
  'venue', 'address', 'neighborhood', 'city', 'category', 'categories',
  'price', 'image_url', 'description', 'source_url', 'source_name',
  'ticket_url', 'performers', 'sold_out', 'editors_pick', 'featured',
  'related_articles', 'updated_at'
];

// Allowed fields for update (same as insert minus slug, plus sponsored)
const ALLOWED_FIELDS_UPDATE = [
  'title', 'date', 'event_date', 'end_date', 'time', 'time_notes',
  'venue', 'address', 'neighborhood', 'city', 'category', 'categories',
  'price', 'image_url', 'description', 'source_url', 'source_name',
  'ticket_url', 'performers', 'sold_out', 'editors_pick', 'featured', 'sponsored',
  'related_articles', 'updated_at'
];

// Validate the caller's Supabase auth token. Returns null on success, or a
// { status, error } object the caller should return.
async function validateAuth(req) {
  var authHeader = req.headers['authorization'] || '';
  var token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { status: 401, error: 'Missing Authorization header. Provide Bearer <supabase_access_token>.' };
  }
  try {
    var userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY }
    });
    if (!userResp.ok) return { status: 401, error: 'Invalid or expired auth token.' };
    var userData = await userResp.json();
    if (!userData.id) return { status: 401, error: 'Could not verify user from token.' };
  } catch (err) {
    return { status: 500, error: 'Auth verification failed: ' + err.message };
  }
  return null;
}

async function handleInsert(req, res) {
  var body = req.body;
  if (!body || !body.event) {
    return res.status(400).json({ error: 'Request body must contain an "event" object with event fields.' });
  }
  var event = body.event;
  var cleanEvent = {};
  for (var key in event) {
    if (ALLOWED_FIELDS_INSERT.indexOf(key) !== -1 && event[key] !== undefined) cleanEvent[key] = event[key];
  }
  var missing = [];
  for (var i = 0; i < REQUIRED_FIELDS.length; i++) {
    if (!cleanEvent[REQUIRED_FIELDS[i]]) missing.push(REQUIRED_FIELDS[i]);
  }
  if (missing.length > 0) return res.status(400).json({ error: 'Missing required fields: ' + missing.join(', ') });
  cleanEvent.updated_at = new Date().toISOString();
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
      return res.status(insertResp.status).json({ error: 'Supabase insert failed', details: errText });
    }
    var inserted = await insertResp.json();
    return res.status(201).json({ success: true, message: 'Event inserted successfully', event: inserted[0] || inserted });
  } catch (err) {
    return res.status(500).json({ error: 'Insert failed: ' + err.message });
  }
}

async function handleUpdate(req, res) {
  var body = req.body;
  if (!body || !body.slug) {
    return res.status(400).json({ error: 'Request body must contain a "slug" string to identify the event.' });
  }
  var slug = body.slug;
  var fields = body.fields || body;
  var cleanFields = {};
  for (var key in fields) {
    if (ALLOWED_FIELDS_UPDATE.indexOf(key) !== -1 && fields[key] !== undefined) cleanFields[key] = fields[key];
  }
  if (Object.keys(cleanFields).length === 0) return res.status(400).json({ error: 'No valid fields to update.' });
  cleanFields.updated_at = new Date().toISOString();
  try {
    var updateResp = await fetch(SUPABASE_URL + '/rest/v1/events?slug=eq.' + encodeURIComponent(slug), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(cleanFields)
    });
    if (!updateResp.ok) {
      var errText = await updateResp.text();
      return res.status(updateResp.status).json({ error: 'Supabase update failed', details: errText });
    }
    var updated = await updateResp.json();
    if (!updated || updated.length === 0) return res.status(404).json({ error: 'No event found with slug: ' + slug });
    return res.status(200).json({ success: true, message: 'Event updated successfully', event: updated[0] || updated });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed: ' + err.message });
  }
}

async function handleDelete(req, res) {
  var body = req.body;
  if (!body || (!body.slug && !body.source_name)) {
    return res.status(400).json({ error: 'Request body must contain a "slug" or "source_name" to identify event(s) to delete.' });
  }
  var filterParam = body.slug
    ? 'slug=eq.' + encodeURIComponent(body.slug)
    : 'source_name=eq.' + encodeURIComponent(body.source_name);
  try {
    var deleteResp = await fetch(SUPABASE_URL + '/rest/v1/events?' + filterParam, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=representation'
      }
    });
    if (!deleteResp.ok) {
      var errText = await deleteResp.text();
      return res.status(deleteResp.status).json({ error: 'Supabase delete failed', details: errText });
    }
    var deleted = await deleteResp.json();
    return res.status(200).json({ success: true, message: 'Deleted ' + deleted.length + ' event(s)', deleted: deleted });
  } catch (err) {
    return res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed. Use POST (insert), PATCH (update), or DELETE.' });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured in Vercel environment.' });
  }

  var authErr = await validateAuth(req);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  if (req.method === 'POST') return handleInsert(req, res);
  if (req.method === 'PATCH') return handleUpdate(req, res);
  return handleDelete(req, res);
};
