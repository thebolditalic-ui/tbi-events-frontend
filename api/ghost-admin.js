const crypto = require('crypto');

// These come from Vercel Environment Variables — never exposed to the browser
const GHOST_URL = process.env.GHOST_URL || 'https://the-bold-italic.ghost.io';
const GHOST_ADMIN_KEY_ID = process.env.GHOST_ADMIN_KEY_ID;
const GHOST_ADMIN_SECRET = process.env.GHOST_ADMIN_SECRET;

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
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check that secrets are configured
  if (!GHOST_ADMIN_KEY_ID || !GHOST_ADMIN_SECRET) {
    return res.status(500).json({ error: 'Ghost Admin credentials not configured' });
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
