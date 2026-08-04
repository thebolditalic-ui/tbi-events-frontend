/* TBI live-reader presence (v4). Loaded by a one-line Ghost footer injection:
   <script src="https://events.thebolditalic.com/tbi-presence.js" defer></script>
   Counts HUMANS on story pages (and the missing-content/404 page):
   - drops known bots (webdriver flag + UA signatures)
   - counts nobody until a human signal: scroll/touch/mouse/key, or 12s actually visible
   - sends document.referrer so broken-page arrivals can be traced to the linking site
   Sends the user-agent too: a JS-executing crawler was walking the archive at about a
   page a second, and with no UA stored there was no way to say who.
   Heartbeats go straight to Supabase with the PUBLIC anon key (insert-only for anon);
   one beat per minute while visible, 30-minute cap per page view. Feeds /analytics. */
(function () {
  'use strict';
  var b = document.body;
  if (!b) return;
  var isStory = b.classList.contains('post-template');
  var isErr = b.classList.contains('error-template') || /^missing story or content/i.test(document.title || '');
  if (!isStory && !isErr) return;
  try { if (navigator.webdriver) return; } catch (e) {}
  var ua = (navigator.userAgent || '').toLowerCase();
  if (/bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|scrapy|python|curl|wget|httpclient|java\/|go-http|facebookexternalhit|embedly|preview/.test(ua)) return;

  var SB = 'https://scawgrjcjgcmvsimvash.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';
  var BEAT_MS = 60000, MAX_MS = 30 * 60000;
  var bannerId = null, started = false;

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
  var title = isErr ? 'Missing story or content' : (document.title || '').replace(/\s*[-|–|]\s*The Bold Italic.*$/i, '').trim().slice(0, 140);
  var ref = (document.referrer || '').slice(0, 300);

  function beat() {
    if (Date.now() - t0 > MAX_MS) return;
    if (document.visibilityState === 'hidden') { setTimeout(beat, BEAT_MS); return; }
    try {
      fetch(SB + '/rest/v1/reader_presence', {
        method: 'POST',
        headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ session_id: sid(), path: path, title: title, banner_id: bannerId, referrer: ref,
                               ua: (navigator.userAgent || '').slice(0, 200) }),
        keepalive: true
      }).catch(function () {});
    } catch (e) {}
    setTimeout(beat, BEAT_MS + Math.floor(Math.random() * 8000));
  }

  // Human gate: a real interaction, or 12 seconds actually on a visible tab.
  function start() { if (started) return; started = true; beat(); }
  function onSignal() { start(); }
  ['scroll', 'mousemove', 'touchstart', 'keydown', 'click'].forEach(function (ev) {
    try { addEventListener(ev, onSignal, { once: true, passive: true }); } catch (e) { addEventListener(ev, onSignal); }
  });
  var dwell = 0;
  var dv = setInterval(function () {
    if (started) { clearInterval(dv); return; }
    if (document.visibilityState === 'visible') dwell += 1000;
    if (dwell >= 12000) { clearInterval(dv); start(); }
  }, 1000);

  // Attach the banner id when the banner system renders one.
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    var el = document.querySelector('[data-tbi-banner-id]');
    if (el) { bannerId = el.getAttribute('data-tbi-banner-id'); clearInterval(iv); }
    else if (tries > 25) { clearInterval(iv); }
  }, 1000);
})();
