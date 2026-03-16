// Vercel Serverless Function — serves Open Graph meta tags for event pages
// Called by middleware.js when a bot/crawler requests an event URL.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';
const SITE_URL = 'https://events.thebolditalic.com';
const DEFAULT_IMAGE = 'https://www.thebolditalic.com/content/images/size/w1200/2025/04/TBILogo-copy.png';

function stripHTML(s) {
  if (!s) return '';
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(s, len) {
  if (!s || s.length <= len) return s || '';
  return s.slice(0, len).replace(/\s+\S*$/, '') + '...';
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  var d = new Date(isoDate);
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return days[d.getUTCDay()] + ', ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

function escapeHTML(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  var slug = req.query.slug;

  if (!slug) {
    return res.status(400).send('Missing slug');
  }

  try {
    // Fetch event from Supabase by slug
    var apiUrl = SUPABASE_URL + '/rest/v1/events?select=title,event_date,end_date,time,time_notes,venue,address,neighborhood,description,image_url,price,slug&slug=eq.' + encodeURIComponent(slug) + '&limit=1';

    var response = await fetch(apiUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
      }
    });

    var data = await response.json();

    if (!data || !data.length) {
      // No event found — serve a generic fallback page for the site
      return serveFallback(res, slug);
    }

    var event = data[0];

    // Build meta content
    var title = event.title || 'Event';
    var ogTitle = title + ' — The Bold Italic Events';
    var image = event.image_url || DEFAULT_IMAGE;
    var dateStr = formatDate(event.event_date);
    if (event.end_date && event.end_date > event.event_date) {
      dateStr += ' – ' + formatDate(event.end_date);
    }

    // Build a description from available fields
    var descParts = [];
    if (dateStr) descParts.push(dateStr);
    if (event.time) descParts.push(event.time);
    if (event.venue) {
      var venuePart = event.venue;
      if (event.neighborhood) venuePart += ', ' + event.neighborhood;
      descParts.push(venuePart);
    }
    if (event.price) descParts.push(event.price);

    var metaDesc = descParts.join(' · ');

    // Add a snippet of the description text if we have room
    var cleanDesc = truncate(stripHTML(event.description), 200);
    if (cleanDesc) {
      metaDesc += (metaDesc ? ' — ' : '') + cleanDesc;
    }

    metaDesc = truncate(metaDesc, 300);

    var canonicalUrl = SITE_URL + '/' + event.slug + '/';

    var html = '<!DOCTYPE html>\n'
      + '<html lang="en">\n<head>\n'
      + '<meta charset="UTF-8">\n'
      + '<title>' + escapeHTML(ogTitle) + '</title>\n'
      + '<meta name="description" content="' + escapeHTML(metaDesc) + '">\n'
      + '<link rel="canonical" href="' + escapeHTML(canonicalUrl) + '">\n'
      + '\n<!-- Open Graph -->\n'
      + '<meta property="og:type" content="event">\n'
      + '<meta property="og:title" content="' + escapeHTML(title) + '">\n'
      + '<meta property="og:description" content="' + escapeHTML(metaDesc) + '">\n'
      + '<meta property="og:image" content="' + escapeHTML(image) + '">\n'
      + '<meta property="og:url" content="' + escapeHTML(canonicalUrl) + '">\n'
      + '<meta property="og:site_name" content="The Bold Italic">\n'
      + '\n<!-- Twitter Card -->\n'
      + '<meta name="twitter:card" content="summary_large_image">\n'
      + '<meta name="twitter:title" content="' + escapeHTML(title) + '">\n'
      + '<meta name="twitter:description" content="' + escapeHTML(metaDesc) + '">\n'
      + '<meta name="twitter:image" content="' + escapeHTML(image) + '">\n'
      + '</head>\n'
      + '<body>\n'
      + '<h1>' + escapeHTML(title) + '</h1>\n'
      + '<p>' + escapeHTML(metaDesc) + '</p>\n'
      + '<p><a href="' + escapeHTML(canonicalUrl) + '">View event</a></p>\n'
      + '</body>\n</html>';

    // Cache for 5 minutes so crawlers don't hammer Supabase
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);

  } catch (err) {
    console.error('OG handler error:', err);
    return serveFallback(res, slug);
  }
};

function serveFallback(res, slug) {
  var title = 'The Bold Italic Events';
  var desc = 'The Bold Italic\'s guide to the greatest events in San Francisco and the Bay Area.';
  var url = SITE_URL + '/' + (slug || '') + '/';

  var html = '<!DOCTYPE html>\n'
    + '<html lang="en">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<title>' + escapeHTML(title) + '</title>\n'
    + '<meta name="description" content="' + escapeHTML(desc) + '">\n'
    + '<meta property="og:title" content="' + escapeHTML(title) + '">\n'
    + '<meta property="og:description" content="' + escapeHTML(desc) + '">\n'
    + '<meta property="og:image" content="' + escapeHTML(DEFAULT_IMAGE) + '">\n'
    + '<meta property="og:url" content="' + escapeHTML(url) + '">\n'
    + '<meta property="og:site_name" content="The Bold Italic">\n'
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + '</head>\n'
    + '<body><p><a href="' + escapeHTML(url) + '">View on The Bold Italic</a></p></body>\n</html>';

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
