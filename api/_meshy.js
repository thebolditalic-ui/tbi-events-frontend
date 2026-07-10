// Shared helpers for the Meshy image-to-3d pipeline. Leading underscore = NOT routed as an endpoint.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const BUCKET = 'tov-assets';
const MESHY_BASE = 'https://api.meshy.ai/openapi/v1';
const MESHY_KEY = process.env.MESHY_API_KEY;

function sbHeaders(extra) { return Object.assign({ apikey: SERVICE, Authorization: 'Bearer ' + SERVICE }, extra || {}); }

async function sbInsert(table, row) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, { method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }), body: JSON.stringify(row) });
  const t = await r.text(); if (!r.ok) throw new Error('insert ' + table + ' ' + r.status + ' ' + t); return JSON.parse(t);
}
async function sbUpdate(table, filter, fields) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + filter, { method: 'PATCH', headers: sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }), body: JSON.stringify(fields) });
  const t = await r.text(); if (!r.ok) throw new Error('update ' + table + ' ' + r.status + ' ' + t); return JSON.parse(t);
}
async function sbSelect(table, query) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + query, { headers: sbHeaders() });
  const t = await r.text(); if (!r.ok) throw new Error('select ' + table + ' ' + r.status + ' ' + t); return JSON.parse(t);
}
async function sbUpload(path, buf, contentType) {
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path, { method: 'POST', headers: sbHeaders({ 'Content-Type': contentType || 'application/octet-stream', 'x-upsert': 'true' }), body: buf });
  const t = await r.text(); if (!r.ok) throw new Error('upload ' + path + ' ' + r.status + ' ' + t); return path;
}
async function sbSign(path, expires) {
  const r = await fetch(SUPABASE_URL + '/storage/v1/object/sign/' + BUCKET + '/' + path, { method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: expires || 3600 }) });
  const t = await r.text(); if (!r.ok) throw new Error('sign ' + path + ' ' + r.status + ' ' + t); return SUPABASE_URL + '/storage/v1' + JSON.parse(t).signedURL;
}
async function meshyGet(taskId) {
  const r = await fetch(MESHY_BASE + '/image-to-3d/' + taskId, { headers: { Authorization: 'Bearer ' + MESHY_KEY } });
  const t = await r.text(); if (!r.ok) throw new Error('meshy get ' + r.status + ' ' + t); return JSON.parse(t);
}
async function meshyCreate(imageUrl) {
  const r = await fetch(MESHY_BASE + '/image-to-3d', { method: 'POST', headers: { Authorization: 'Bearer ' + MESHY_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, should_texture: true, enable_pbr: true, auto_size: true, origin_at: 'bottom', target_formats: ['glb'] }) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) {} return { ok: r.ok, status: r.status, body: j, raw: t };
}
// Resolve a task that likely reached a terminal state. Idempotent: a row already 'ready' is a no-op.
async function resolveTask(row) {
  if (!row || !row.meshy_task_id) return { skipped: 'no task id' };
  if (row.status === 'ready') return { skipped: 'already ready' };
  const task = await meshyGet(row.meshy_task_id);
  if (task.status === 'SUCCEEDED') {
    const glbUrl = task.model_urls && task.model_urls.glb;
    if (!glbUrl) throw new Error('SUCCEEDED but no glb url');
    const resp = await fetch(glbUrl); if (!resp.ok) throw new Error('glb download ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    const glbPath = 'source/' + row.id + '.glb';
    await sbUpload(glbPath, buf, 'model/gltf-binary');
    await sbUpdate('tov_generations', 'id=eq.' + row.id, { glb_path: glbPath, thumbnail_url: task.thumbnail_url || null, credits: task.consumed_credits || 0, status: 'ready', ready_at: new Date().toISOString(), error: null });
    return { status: 'ready', bytes: buf.length };
  }
  if (task.status === 'FAILED' || task.status === 'CANCELED') {
    await sbUpdate('tov_generations', 'id=eq.' + row.id, { status: 'failed', error: (task.task_error && task.task_error.message) || task.status, credits: 0 });
    return { status: 'failed' };
  }
  return { status: 'pending', meshy: task.status, progress: task.progress };
}
module.exports = { SUPABASE_URL, SERVICE, ANON, BUCKET, MESHY_KEY, sbInsert, sbUpdate, sbSelect, sbUpload, sbSign, meshyGet, meshyCreate, resolveTask };
