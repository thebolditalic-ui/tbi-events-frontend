/* TBI live-reader presence (v2). Loaded by a one-line Ghost footer injection:
   <script src="https://events.thebolditalic.com/tbi-presence.js" defer></script>
   Fires on every STORY page (body.post-template), with or without a banner; when the
   banner system renders one, its id rides along on subsequent heartbeats. Heartbeats go
   straight to Supabase with the PUBLIC anon key; the table is insert-only for anon
   (nobody can read it back without the admin login). One beat per minute while the tab
   is visible, 30-minute cap per page view. Feeds "Reading right now" on /analytics. */
(function () {
  'use strict';
  if (!document.body || !document.body.classList.contains('post-template')) return;
  var SB = 'https://scawgrjcjgcmvsimvash.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';
  var BEAT_MS = 60000, MAX_MS = 30 * 60000;
  var bannerId = null;
  function sid() {
    try {
      var k = 'tbi_banner_session_id';
      var v = localStorage.getItem(k);
      if (!v) { v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('s' + String(Math.random()).slice(2)); localStorage.setItem(k, v); }
      return v;
    } catch (e) { return 'anon-' + String(Math.random()).slice(2, 10); }
  }
  var t0 = Date.now();
  var path = location.pathname;
  var title = (document.title || '').replace(/\s*[-|–|]\s*The Bold Italic.*$/i, '').trim().slice(0, 140);
  function beat() {
    if (Date.now() - t0 > MAX_MS) return;
    if (document.visibilityState === 'hidden') { setTimeout(beat, BEAT_MS); return; }
    try {
      fetch(SB + '/rest/v1/reader_presence', {
        method: 'POST',
        headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ session_id: sid(), path: path, title: title, banner_id: bannerId }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
    setTimeout(beat, BEAT_MS + Math.floor(Math.random() * 8000));
  }
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    var el = document.querySelector('[data-tbi-banner-id]');
    if (el) { bannerId = el.getAttribute('data-tbi-banner-id'); clearInterval(iv); }
    else if (tries > 25) { clearInterval(iv); }
  }, 1000);
  beat();
})();
