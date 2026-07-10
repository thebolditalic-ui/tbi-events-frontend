// GET /api/meshy-reconcile?s=<MESHY_WEBHOOK_SECRET>  -- cron fallback for dropped webhooks.
const M = require('./_meshy.js');
module.exports = async function handler(req, res) {
  var secret = process.env.MESHY_WEBHOOK_SECRET || '';
  if (!secret || !req.query || req.query.s !== secret) return res.status(404).end();
  if (!M.SERVICE || !M.MESHY_KEY) return res.status(500).json({ error: 'env not configured' });
  try {
    var cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    var stale = await M.sbSelect('tov_generations', 'status=eq.running&created_at=lt.' + encodeURIComponent(cutoff) + '&select=*&order=created_at.asc&limit=25');
    var out = [];
    for (var i = 0; i < stale.length; i++) {
      var row = stale[i];
      if (Date.now() - new Date(row.created_at).getTime() > 6 * 3600 * 1000) {
        await M.sbUpdate('tov_generations', 'id=eq.' + row.id, { status: 'expired', error: 'timed out (no result in 6h)' });
        out.push({ id: row.id, status: 'expired' }); continue;
      }
      try { out.push(Object.assign({ id: row.id }, await M.resolveTask(row))); }
      catch (e) { out.push({ id: row.id, error: e.message }); }
    }
    return res.status(200).json({ checked: stale.length, results: out });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
