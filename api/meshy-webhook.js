// POST /api/meshy-webhook?s=<MESHY_WEBHOOK_SECRET>  -- Meshy posts on status change.
// We do NOT trust the payload; we read only the task id, then re-GET the task with our own key.
const M = require('./_meshy.js');
function readBody(req) { if (!req.body) return {}; if (typeof req.body === 'object') return req.body; try { return JSON.parse(req.body); } catch (e) { return {}; } }

module.exports = async function handler(req, res) {
  var secret = process.env.MESHY_WEBHOOK_SECRET || '';
  if (!secret || !req.query || req.query.s !== secret) return res.status(404).end();
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!M.SERVICE || !M.MESHY_KEY) return res.status(200).json({ ok: false, note: 'env not configured' });
  var body = readBody(req);
  var taskId = body.id || body.result || (body.data && body.data.id) || '';
  if (!taskId) return res.status(200).json({ ok: true, note: 'no task id in payload' });
  try {
    var rows = await M.sbSelect('tov_generations', 'meshy_task_id=eq.' + encodeURIComponent(taskId) + '&select=*');
    var row = rows && rows[0];
    if (!row) return res.status(200).json({ ok: true, note: 'no matching generation' });
    var result = await M.resolveTask(row);
    return res.status(200).json({ ok: true, result: result });
  } catch (e) {
    // still 200 so Meshy keeps delivering; the reconcile cron is the safety net
    return res.status(200).json({ ok: false, error: e.message });
  }
};
