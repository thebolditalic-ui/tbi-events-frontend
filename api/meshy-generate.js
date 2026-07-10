// POST /api/meshy-generate  -- operator uploads a flat PNG; we store it, kick off Meshy image-to-3d.
const M = require('./_meshy.js');
const ANON = process.env.SUPABASE_ANON_KEY;

async function validateAuth(req) {
  var token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { status: 401, error: 'Missing Authorization header.' };
  try {
    var u = await fetch(M.SUPABASE_URL + '/auth/v1/user', { headers: { Authorization: 'Bearer ' + token, apikey: ANON } });
    if (!u.ok) return { status: 401, error: 'Invalid or expired auth token.' };
    var ud = await u.json(); if (!ud.id) return { status: 401, error: 'Could not verify user.' };
  } catch (e) { return { status: 500, error: 'Auth verification failed: ' + e.message }; }
  return null;
}
function readBody(req) { if (!req.body) return {}; if (typeof req.body === 'object') return req.body; try { return JSON.parse(req.body); } catch (e) { return {}; } }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!M.SERVICE) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured.' });
  if (!M.MESHY_KEY) return res.status(500).json({ error: 'MESHY_API_KEY not configured in Vercel.' });
  var authErr = await validateAuth(req); if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  var body = readBody(req);
  var b64 = body.image_base64 || '';
  var name = (body.name || '').toString().slice(0, 120);
  if (!b64) return res.status(400).json({ error: 'image_base64 required (PNG data URI or raw base64).' });
  var comma = b64.indexOf(','); if (b64.slice(0, 5) === 'data:' && comma >= 0) b64 = b64.slice(comma + 1);
  var buf; try { buf = Buffer.from(b64, 'base64'); } catch (e) { return res.status(400).json({ error: 'bad base64' }); }
  if (!buf.length) return res.status(400).json({ error: 'empty image' });

  var genId = require('crypto').randomUUID();
  var pngPath = 'uploads/' + genId + '.png';
  try {
    await M.sbUpload(pngPath, buf, 'image/png');
    var signed = await M.sbSign(pngPath, 3600);
    await M.sbInsert('tov_generations', { id: genId, status: 'queued', name: name || null, source_png_path: pngPath });
    var mk = await M.meshyCreate(signed);
    if (!mk.ok) {
      var emap = { 402: 'Insufficient Meshy credits.', 429: 'Meshy rate limit hit (max 10 queued). Try again shortly.' };
      var msg = emap[mk.status] || ('Meshy error ' + mk.status + ': ' + ((mk.body && mk.body.message) || mk.raw || ''));
      await M.sbUpdate('tov_generations', 'id=eq.' + genId, { status: 'failed', error: msg });
      return res.status(mk.status === 402 || mk.status === 429 ? mk.status : 502).json({ error: msg, gen_id: genId });
    }
    await M.sbUpdate('tov_generations', 'id=eq.' + genId, { meshy_task_id: mk.body.result, status: 'running' });
    return res.status(200).json({ gen_id: genId, meshy_task_id: mk.body.result, status: 'running' });
  } catch (e) {
    try { await M.sbUpdate('tov_generations', 'id=eq.' + genId, { status: 'failed', error: e.message }); } catch (_) {}
    return res.status(500).json({ error: 'Generate failed: ' + e.message, gen_id: genId });
  }
};
