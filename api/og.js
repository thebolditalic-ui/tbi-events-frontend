// Vercel Serverless Function — serves Open Graph meta tags for event pages
// Called by middleware.js when a bot/crawler requests an event URL.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://scawgrjcjgcmvsimvash.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNjYXdncmpjamdjbXZzaW12YXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NzAxMDIsImV4cCI6MjA4ODM0NjEwMn0.lmks8ntJPZ0giQEpuH3tSSBllzmOj20oUrb96kBIdh0';
const SITE_URL = 'https://events.thebolditalic.com';
const DEFAULT_IMAGE = 'https://www.thebolditalic.com/content/images/size/w1200/2025/04/TBILogo-copy.png';

// Category-filter slugs (events.thebolditalic.com/<slug>) are list views,
// not events. A bot crawling one should get a real category share card,
// not the 'event not found' 404. slug -> display name.
const CATEGORY_OG = {
  'music': 'Music', 'comedy': 'Comedy', 'art-culture': 'Art & Culture', 'art': 'Art',
  'food-drink': 'Food & Drink', 'festivals': 'Festivals', 'sports-recreation': 'Sports & Recreation',
  'nightlife': 'Nightlife', 'community': 'Community', 'film-media': 'Film & Media',
  'lgbtq': 'LGBTQ+', 'events': 'Events', 'editors-pick': 'Editor\u2019s Pick'
};

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

  // Category-filter URL (e.g. /lgbtq) -> serve a category share card
  // instead of an event lookup (which would 404).
  var catName = CATEGORY_OG[String(slug).toLowerCase()];
  if (catName) {
    return serveCategoryCard(res, slug, catName);
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

    // Round-14: build a JSON-LD Event block so Google's "Events on [date]"
    // rich results can pick up the event. Only include fields we actually
    // have — Schema.org tolerates partials, but invalid types (e.g. an
    // empty string for startDate) get the whole block rejected.
    var jsonLd = buildEventJsonLd(event, canonicalUrl, image);

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
      + (jsonLd ? '\n<script type="application/ld+json">\n' + jsonLd + '\n</script>\n' : '')
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
    // Round-14: any unexpected error (Supabase brief outage, network hiccup)
    // should return 503 — that tells Googlebot "try again later" and keeps
    // the event in the index. Returning 404 here would risk dropping real
    // events whenever Supabase has a momentary issue.
    console.error('OG handler error:', err);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '120');
    return res.status(503).send('Service temporarily unavailable');
  }
};

// Round-19: share card for a category-filter URL (e.g. /lgbtq). Returns 200
// so the social preview renders, but noindex,follow to match the list-page
// SEO posture — filter views aren't indexed, only per-event pages are.
function serveCategoryCard(res, slug, catName) {
  var slugLc = String(slug).toLowerCase();
  var isPick = (slugLc === 'editors-pick');
  var title = isPick
    ? 'Editor\u2019s Picks \u2014 SF Events from The Bold Italic'
    : catName + ' Events in SF \u2014 The Bold Italic';
  var desc = isPick
    ? 'Our editors\u2019 picks for the best upcoming events in San Francisco and the Bay Area.'
    : 'Upcoming ' + catName + ' events in San Francisco and the Bay Area, curated by The Bold Italic.';
  var canonicalUrl = SITE_URL + '/' + slugLc + '/';
  var html = '<!DOCTYPE html>\n'
    + '<html lang="en">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<title>' + escapeHTML(title) + '</title>\n'
    + '<meta name="description" content="' + escapeHTML(desc) + '">\n'
    + '<meta name="robots" content="noindex, follow">\n'
    + '<link rel="canonical" href="' + escapeHTML(canonicalUrl) + '">\n'
    + '\n<!-- Open Graph -->\n'
    + '<meta property="og:type" content="website">\n'
    + '<meta property="og:title" content="' + escapeHTML(title) + '">\n'
    + '<meta property="og:description" content="' + escapeHTML(desc) + '">\n'
    + '<meta property="og:image" content="' + escapeHTML(DEFAULT_IMAGE) + '">\n'
    + '<meta property="og:url" content="' + escapeHTML(canonicalUrl) + '">\n'
    + '<meta property="og:site_name" content="The Bold Italic">\n'
    + '\n<!-- Twitter Card -->\n'
    + '<meta name="twitter:card" content="summary_large_image">\n'
    + '<meta name="twitter:title" content="' + escapeHTML(title) + '">\n'
    + '<meta name="twitter:description" content="' + escapeHTML(desc) + '">\n'
    + '<meta name="twitter:image" content="' + escapeHTML(DEFAULT_IMAGE) + '">\n'
    + '</head>\n'
    + '<body>\n'
    + '<h1>' + escapeHTML(title) + '</h1>\n'
    + '<p>' + escapeHTML(desc) + '</p>\n'
    + '<p><a href="' + escapeHTML(canonicalUrl) + '">Browse events</a></p>\n'
    + '</body>\n</html>';
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, follow');
  return res.status(200).send(html);
}

// Round-14: when a crawler asks for a slug that doesn't exist, return a
// real 404 with noindex headers. Previously this returned 200 with a
// generic page, which (a) wasted Google's crawl budget on phantom URLs
// and (b) risked them landing in the index. The 200-with-meta-noindex
// pattern doesn't work either — robots tag in HTML is ignored on URLs
// that 404, but X-Robots-Tag in the header is the safe belt-and-suspenders.
function serveFallback(res, slug) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  return res.status(404).send(
      '<!DOCTYPE html>\n'
    + '<html lang="en"><head><meta charset="UTF-8">\n'
    + '<meta name="robots" content="noindex, nofollow">\n'
    + '<title>Event not found — The Bold Italic</title></head>\n'
    + '<body><h1>Event not found</h1>\n'
    + '<p>The event you\'re looking for isn\'t on our site. '
    +   '<a href="' + escapeHTML(SITE_URL) + '/">Browse all events</a>.</p>\n'
    + '</body></html>'
  );
}

// Round-14: build a Schema.org Event JSON-LD payload. Returns null if we
// don't have the minimum required fields (name + valid startDate).
// We pass startDate/endDate through as ISO strings; Google accepts both
// date-only ("2026-05-12") and full ISO timestamps. We don't try to
// combine event_date + time strings — time fields in the DB are free
// text ("7:00 PM", "doors at 6"), so parsing is unreliable. Date-only
// is fine for rich results.
function buildEventJsonLd(event, canonicalUrl, image) {
  if (!event || !event.event_date) return null;

  var startDate = isoDateOnly(event.event_date);
  if (!startDate) return null;

  var ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    'name': event.title || 'Event',
    'startDate': startDate,
    'eventStatus': 'https://schema.org/EventScheduled',
    'eventAttendanceMode': 'https://schema.org/OfflineEventAttendanceMode',
    'url': canonicalUrl,
    'organizer': {
      '@type': 'Organization',
      'name': 'The Bold Italic',
      'url': 'https://www.thebolditalic.com/'
    }
  };

  var endDate = isoDateOnly(event.end_date);
  if (endDate && endDate >= startDate) ld.endDate = endDate;

  if (image) ld.image = image;

  // Description
  var cleanDesc = stripHTML(event.description || '');
  if (cleanDesc) ld.description = truncate(cleanDesc, 500);

  // Location: at minimum we need a name. Address is optional but improves
  // the rich result.
  if (event.venue) {
    var loc = { '@type': 'Place', 'name': event.venue };
    var addrParts = [];
    if (event.address) addrParts.push(event.address);
    if (event.neighborhood) addrParts.push(event.neighborhood);
    if (addrParts.length > 0) {
      loc.address = {
        '@type': 'PostalAddress',
        'streetAddress': event.address || event.venue,
        'addressLocality': event.neighborhood || 'San Francisco',
        'addressRegion': 'CA',
        'addressCountry': 'US'
      };
    } else {
      loc.address = { '@type': 'PostalAddress', 'addressLocality': 'San Francisco', 'addressRegion': 'CA', 'addressCountry': 'US' };
    }
    ld.location = loc;
  } else {
    ld.location = {
      '@type': 'Place',
      'name': 'San Francisco Bay Area',
      'address': { '@type': 'PostalAddress', 'addressLocality': 'San Francisco', 'addressRegion': 'CA', 'addressCountry': 'US' }
    };
  }

  // Offers (price). We only know a free-text price string, which Google's
  // strict validator dislikes. Skip if we can't parse a clean number, but
  // include availability + URL for free events.
  if (event.price) {
    var priceText = String(event.price).toLowerCase();
    var freeMatch = priceText.indexOf('free') !== -1 || priceText === '0' || priceText === '$0';
    var priceMatch = String(event.price).match(/\$?\s*(\d+(?:\.\d+)?)/);
    if (freeMatch) {
      ld.offers = {
        '@type': 'Offer',
        'price': '0',
        'priceCurrency': 'USD',
        'availability': 'https://schema.org/InStock',
        'url': canonicalUrl
      };
    } else if (priceMatch) {
      ld.offers = {
        '@type': 'Offer',
        'price': priceMatch[1],
        'priceCurrency': 'USD',
        'availability': 'https://schema.org/InStock',
        'url': canonicalUrl
      };
    }
  }

  return JSON.stringify(ld, null, 2);
}

// Returns 'YYYY-MM-DD' from an ISO timestamp, or null if the input
// doesn't parse cleanly.
function isoDateOnly(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  var y = d.getUTCFullYear();
  var m = String(d.getUTCMonth() + 1).padStart(2, '0');
  var day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
