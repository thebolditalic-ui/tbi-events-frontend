const crypto = require('crypto');

// These come from Vercel Environment Variables — never exposed to the browser
const GHOST_URL = process.env.GHOST_URL || 'https://the-bold-italic.ghost.io';
const GHOST_ADMIN_KEY_ID = process.env.GHOST_ADMIN_KEY_ID;
const GHOST_ADMIN_SECRET = process.env.GHOST_ADMIN_SECRET;

// Supabase — used to validate the caller's session token before allowing this
// admin action. Same pattern as insert-event.js / update-event.js / delete-event.js.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

function createGhostAdminJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: GHOST_ADMIN_KEY_ID };
  const payload = { iat: now, exp: now + 300, aud: '/admin/' };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = headerB64 + '.' + payloadB64;

  const keyData = Buffer.from(GHOST_ADMIN_SECRET, 'hex');
  const sig = crypto.createHmac('sha256', keyData).update(sigInput).digest('base64url');

  return sigInput + '.' + sig;
}

module.exports = async function handler(req, res) {
  // CORS headers (matches the other /api routes)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check that secrets are configured
  if (!GHOST_ADMIN_KEY_ID || !GHOST_ADMIN_SECRET) {
    return res.status(500).json({ error: 'Ghost Admin credentials not configured' });
  }

  // ---- Validate the caller's Supabase auth token ----
  // This was missing previously: anyone with the URL could POST to this
  // endpoint and strip #featuredevent tags from any Ghost post by ID.
  // Now we require a valid Supabase session token, same as the other routes.
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

  const { action, postId } = req.body || {};

  if (action !== 'remove-featured-tag' || !postId) {
    return res.status(400).json({ error: 'Invalid request. Expected { action: "remove-featured-tag", postId: "..." }' });
  }

  try {
    const jwt = createGhostAdminJWT();

    // Fetch the post to get current tags and updated_at
    const getResp = await fetch(GHOST_URL + '/ghost/api/admin/posts/' + postId + '/?formats=mobiledoc', {
      headers: { 'Authorization': 'Ghost ' + jwt }
    });

    if (!getResp.ok) {
      return res.status(getResp.status).json({ error: 'Ghost API error: ' + getResp.statusText });
    }

    const getData = await getResp.json();
    if (!getData.posts || !getData.posts[0]) {
      return res.status(404).json({ error: 'Post not found in Ghost' });
    }

    const post = getData.posts[0];
    const newTags = (post.tags || []).filter(function(t) { return t.name !== '#featuredevent'; });

    // Update the post with the tag removed
    const updateResp = await fetch(GHOST_URL + '/ghost/api/admin/posts/' + postId + '/', {
      method: 'PUT',
      headers: {
        'Authorization': 'Ghost ' + jwt,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        posts: [{
          tags: newTags,
          updated_at: post.updated_at
        }]
      })
    });

    const updateData = await updateResp.json();
    if (updateData.errors) {
      return res.status(400).json({ error: 'Ghost API error: ' + (updateData.errors[0] || {}).message });
    }

    return res.status(200).json({ success: true, title: post.title });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
