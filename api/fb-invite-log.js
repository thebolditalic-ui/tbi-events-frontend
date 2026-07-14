// /api/fb-invite-log.js — server-side logger for the FB invite bookmarklet.
// The bookmarklet runs inside facebook.com, whose CSP blocks any direct call to
// Supabase, and some browsers/extensions block third-party calls from our logger
// page too. So at the end of a run the bookmarklet NAVIGATES the tab here and we
// do the insert server-side (unblockable), then 302 back to the Facebook post.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';

function safeBack(page) {
  try { if (page && /^https?:\/\/([a-z0-9-]+\.)?facebook\.com\//i.test(page)) return page; } catch (e) {}
  return 'https://www.facebook.com/';
}

module.exports = async function handler(req, res) {
  var q = req.query || {};
  var back = safeBack(q.page || '');
  var cRaw = q.c;
  var c = parseInt(cRaw, 10);
  var hasCount = (cRaw !== undefined && cRaw !== null && cRaw !== '' && !isNaN(c) && c >= 0);

  if (hasCount) {
    try {
      await fetch(SUPABASE_URL + '/rest/v1/fb_invite_log', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ invited_count: c, page_url: (q.page || null), post_ref: (q.ref || null), note: 'bookmarklet' })
      });
    } catch (e) { /* swallow; still redirect so the user is never stranded */ }
  }

  res.setHeader('Location', back);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(302).end();
};
