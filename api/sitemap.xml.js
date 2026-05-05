// /api/sitemap.xml.js — Vercel serverless function
// Generates a dynamic XML sitemap of indexable event pages from Supabase.
//
// What goes in:
//   - Every event whose event_date is within (last 30 days .. infinity).
//     Events that ended more than 30 days ago drop off the sitemap and
//     will eventually fall out of Google's index naturally. Events with
//     no event_date are skipped — Schema.org Event needs a date anyway.
//
// What's intentionally excluded:
//   - The homepage (/) — it's noindex by design (the events list itself
//     isn't a useful search result; we want Google focused on individual
//     events instead). See robots.txt comment.
//   - Admin surfaces and tracking endpoints (covered by robots.txt too).
//
// Cache:
//   - 5 min CDN cache + stale-while-revalidate. The sitemap doesn't need
//     to be fresh-to-the-second; this keeps Supabase load low when
//     Googlebot crawls aggressively.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';
const SITE_URL = 'https://events.thebolditalic.com';

// Window: include events from 30 days in the past forward. Past events
// stay indexable while they're still reasonably "fresh" (people may
// search after the fact); older events naturally age out.
const PAST_WINDOW_DAYS = 30;

function escapeXml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDateOnly(d) {
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).send('Method not allowed');
  }

  try {
    var cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - PAST_WINDOW_DAYS);
    var cutoffIso = cutoff.toISOString();

    // Pull only the columns we need. Order by event_date so the freshest
    // dates float to the top of the sitemap (Google reads top-to-bottom).
    var apiUrl = SUPABASE_URL
      + '/rest/v1/events'
      + '?select=slug,event_date,updated_at'
      + '&event_date=gte.' + encodeURIComponent(cutoffIso)
      + '&order=event_date.desc'
      + '&limit=10000';

    var r = await fetch(apiUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    });

    if (!r.ok) {
      console.error('sitemap fetch failed', r.status, await r.text());
      // 503 keeps Google's existing sitemap-derived index intact — they'll
      // retry. A 200 with an empty sitemap would tell them "delete everything".
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '120');
      return res.status(503).send('Service temporarily unavailable');
    }

    var rows = await r.json();
    var seen = {};
    var urls = [];

    rows.forEach(function (row) {
      if (!row.slug) return;
      if (seen[row.slug]) return;
      seen[row.slug] = true;

      // Use updated_at as lastmod when present so Google re-crawls when an
      // event's data changes; otherwise fall back to the event date.
      var lastmodSource = row.updated_at || row.event_date;
      var lastmodDate = lastmodSource ? new Date(lastmodSource) : null;
      var lastmod = (lastmodDate && !isNaN(lastmodDate.getTime()))
        ? isoDateOnly(lastmodDate)
        : null;

      urls.push({
        loc: SITE_URL + '/' + row.slug + '/',
        lastmod: lastmod
      });
    });

    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    urls.forEach(function (u) {
      xml += '  <url>\n';
      xml += '    <loc>' + escapeXml(u.loc) + '</loc>\n';
      if (u.lastmod) xml += '    <lastmod>' + escapeXml(u.lastmod) + '</lastmod>\n';
      xml += '    <changefreq>weekly</changefreq>\n';
      xml += '  </url>\n';
    });

    xml += '</urlset>\n';

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(xml);

  } catch (err) {
    console.error('sitemap error:', err);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '120');
    return res.status(503).send('Service temporarily unavailable');
  }
};
