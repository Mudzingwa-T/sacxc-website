const express = require('express');
const session = require('express-session');
const WasmSqliteStore = require('./middleware/session-store');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const { initDb, getDb, getRawDb } = require('./middleware/database');
const { buildData } = require('./lib/site-data');

const app = express();
const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------------------
// Reverse-proxy awareness. Hostinger (and pretty much every production host)
// puts a reverse proxy in front of Node, so X-Forwarded-For / X-Forwarded-Proto
// headers are set. Express must be told to trust them, otherwise:
//   - req.ip is always the proxy's IP (rate limiter can't distinguish users)
//   - express-rate-limit throws the ERR_ERL_UNEXPECTED_X_FORWARDED_FOR error
//     we saw in the Hostinger logs
// Setting "1" trusts exactly one proxy hop — correct for Hostinger.
// -----------------------------------------------------------------------------
app.set('trust proxy', 1);

// Security
app.disable('x-powered-by');
app.disable('etag');
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  }
}));
// Gzip/deflate all compressible responses. level 6 is the sweet spot of
// ratio vs CPU; only compress payloads above ~1KB so tiny responses aren't
// wasted on compression overhead.
app.use(compression({ level: 6, threshold: 1024 }));

// Strip any remaining tech-stack hints from every response
app.use((req, res, next) => {
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  next();
});

// Rate limiting — skip localhost in dev
const skipLocal = (req) => process.env.NODE_ENV !== 'production' && (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1');
// General limiter is per-IP. 1200 req / 15 min ≈ 80 req/min per visitor — far
// above what a human browsing generates, but still stops scrapers/floods.
// Static assets are excluded so image/CSS/JS bursts on a page load don't count.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => skipLocal(req) ||
    req.path.startsWith('/css') || req.path.startsWith('/js') ||
    req.path.startsWith('/images') || req.path.startsWith('/vendor') ||
    req.path.startsWith('/uploads') || req.path.startsWith('/favicon'),
});
app.use(limiter);
// Login is the brute-force target — keep it tight and per-IP.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, skip: skipLocal, message: 'Too many login attempts. Please try again later.' });

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Cache compiled templates in production — recompiling EJS on every request is
// pure wasted CPU under load. Left off in dev so template edits show instantly.
if (process.env.NODE_ENV === 'production') app.set('view cache', true);

// Static files. Long cache for fingerprint-stable assets; uploads a bit shorter.
// immutable tells browsers never to revalidate within the max-age window.
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '30d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (/\.(?:css|js|woff2?|jpg|jpeg|png|svg|webp|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  },
}));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { maxAge: '7d' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// -----------------------------------------------------------------------------
// Session store — persistent across restarts, pure-WASM SQLite (no native deps).
//
// Sessions are stored in the same on-disk SQLite database as the rest of the
// app, via a small custom store (middleware/session-store.js) built on
// node-sqlite3-wasm. This:
//   - survives the ungraceful Passenger restarts that used to silently log
//     admins out mid-edit (the old MemoryStore lost every login on restart);
//   - installs on any host/Node version because there is nothing to compile;
//   - prunes expired rows so it stays bounded even under heavy traffic.
//
// The store is attached inside startServer() AFTER initDb() has run, because it
// needs the initialised database handle (getRawDb()).
// -----------------------------------------------------------------------------
function buildSessionMiddleware() {
  return session({
    store: new WasmSqliteStore({
      db: getRawDb(),
      table: 'sessions',
      pruneIntervalMs: 15 * 60 * 1000,
    }),
    secret: process.env.SESSION_SECRET || 'sacxc-change-this-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true, // refresh cookie expiry on activity so active admins stay in
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      // secure=true behind Hostinger's TLS-terminating proxy (requires trust proxy, set above)
      secure: 'auto',
      sameSite: 'lax',
    }
  });
}

// Placeholder that delegates to the real session middleware once it's built.
// This lets us keep the middleware ordering below unchanged while still
// deferring store creation until the DB is ready.
let _sessionMw = null;
app.use((req, res, next) => {
  if (!_sessionMw) return next(); // DB not ready yet (shouldn't happen post-boot)
  return _sessionMw(req, res, next);
});

// Extra security headers (AFTER session so they never interfere with Set-Cookie)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://embed.tawk.to https://*.tawk.to",
    "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com https://embed.tawk.to",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.tawk.to wss://*.tawk.to",
    "frame-src 'self' https://*.tawk.to",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()');
  next();
});

// -----------------------------------------------------------------------------
// Global template data (settings, member stat, nav menu, editable content).
//
// This runs on every request. The underlying data (site settings, menu, page
// content) changes rarely — only when an admin edits it — but was being read
// from the DB 4+ times on EVERY pageview. Under load that's the single biggest
// source of redundant queries. We cache the assembled bundle in memory for a
// few seconds, so a burst of traffic is served almost entirely from RAM while
// edits still appear within the TTL. The CMS can also call
// app.locals.invalidateGlobals() to clear it immediately after a save.
// -----------------------------------------------------------------------------
const GLOBALS_TTL_MS = 10 * 1000;
let _globalsCache = null;
let _globalsCachedAt = 0;

function computeGlobals() {
  const out = { settings: {}, menu: [], content: {} };
  try {
    const db = getDb();
    const settings = {};
    db.prepare('SELECT key, value FROM site_settings').all().forEach(r => { settings[r.key] = r.value; });
    try {
      const ctr = db.prepare('SELECT base_count FROM member_counter WHERE id = 1').get();
      const approved = db.prepare("SELECT COUNT(*) c FROM membership_applications WHERE status='approved'").get();
      if (ctr) {
        const total = (ctr.base_count || 1800) + (approved ? approved.c : 0);
        settings.stats_members = total.toLocaleString('en-US') + '+';
        settings.stats_members_raw = total;
      }
    } catch (e) { /* tolerate missing tables on first boot */ }
    out.settings = settings;
    try {
      out.menu = db.prepare("SELECT label, url FROM menu_items WHERE active = 1 AND location = 'header' ORDER BY sort_order ASC").all() || [];
    } catch (e) { out.menu = []; }
    try {
      const map = {};
      db.prepare('SELECT page_slug, section_key, content FROM page_content').all().forEach(r => { map[r.page_slug + '.' + r.section_key] = r.content; });
      out.content = map;
    } catch (e) { out.content = {}; }
  } catch (e) { /* leave defaults */ }
  return out;
}

function getGlobals() {
  const now = Date.now();
  if (_globalsCache && (now - _globalsCachedAt) < GLOBALS_TTL_MS) return _globalsCache;
  _globalsCache = computeGlobals();
  _globalsCachedAt = now;
  return _globalsCache;
}
// Let the CMS force an immediate refresh after an edit.
app.locals.invalidateGlobals = () => { _globalsCache = null; _globalsCachedAt = 0; };

// Flash messages & settings
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.session.success; delete req.session.success;
  res.locals.error = req.session.error; delete req.session.error;
  res.locals.currentPath = req.path;
  const g = getGlobals();
  res.locals.settings = g.settings;
  res.locals.menu = g.menu;
  res.locals.content = g.content;
  next();
});

// File upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
app.locals.upload = upload;
app.locals.loginLimiter = loginLimiter;

// -----------------------------------------------------------------------------
// Page-view tracking — buffered.
//
// Writing one row to SQLite on every single pageview serialises all those
// writes and becomes the bottleneck under heavy traffic (SQLite allows one
// writer at a time). Instead we push views into an in-memory buffer and flush
// them in a single batched transaction every few seconds. Analytics tolerate a
// few seconds' delay; the throughput win is large. The buffer is capped so a
// traffic spike can never blow up memory, and it flushes on shutdown.
// -----------------------------------------------------------------------------
const _viewBuffer = [];
const VIEW_BUFFER_MAX = 5000;

function flushViews() {
  if (_viewBuffer.length === 0) return;
  const batch = _viewBuffer.splice(0, _viewBuffer.length);
  try {
    const raw = getRawDb();
    const stmt = raw.prepare('INSERT INTO page_views (path, ip, user_agent, referer) VALUES (?,?,?,?)');
    // Wrap the batch in a single transaction — one fsync instead of N.
    raw.exec('BEGIN');
    try {
      for (const v of batch) stmt.run([v.path, v.ip, v.ua, v.ref]);
      raw.exec('COMMIT');
    } catch (e) {
      try { raw.exec('ROLLBACK'); } catch (_) {}
    }
  } catch (e) { /* tolerate missing table / not-ready DB */ }
}
const _viewTimer = setInterval(flushViews, 5000);
if (_viewTimer.unref) _viewTimer.unref();

app.use((req, res, next) => {
  try {
    if (req.method === 'GET' &&
        !req.path.startsWith('/sacxc-cms') &&
        !req.path.startsWith('/admin') &&
        !req.path.startsWith('/api') &&
        !req.path.startsWith('/uploads') &&
        !req.path.startsWith('/images') &&
        !req.path.startsWith('/css') &&
        !req.path.startsWith('/js') &&
        !req.path.startsWith('/favicon') &&
        !req.path.startsWith('/.well-known') &&
        !req.path.includes('.')) {
      if (_viewBuffer.length < VIEW_BUFFER_MAX) {
        _viewBuffer.push({
          path: req.path,
          ip: req.ip || '',
          ua: (req.headers['user-agent'] || '').substring(0, 250),
          ref: (req.headers['referer'] || '').substring(0, 250),
        });
      }
    }
  } catch (e) { /* never let tracking break a request */ }
  next();
});
// Make sure buffered views are persisted on shutdown.
process.on('SIGINT', flushViews);
process.on('SIGTERM', flushViews);
process.on('exit', flushViews);

// -----------------------------------------------------------------------------
// Maintenance mode gate.
//
// When the `maintenance_mode` site setting is '1', the public website serves a
// friendly "Under Maintenance" page (HTTP 503) instead of the normal pages.
//
// It is deliberately permissive about who/what still gets through, so an admin
// can keep working and the site doesn't break for crawlers/assets:
//   - The CMS itself (/sacxc-cms, /admin) is ALWAYS reachable, so an admin can
//     turn maintenance mode back off.
//   - Logged-in admin users bypass the gate entirely and see the live site, so
//     they can preview/verify before lifting maintenance.
//   - Static assets (css/js/images/uploads/favicon) still load, so the
//     maintenance page itself renders correctly.
//   - robots.txt / .well-known / sitemap are left alone.
//
// The 503 status + Retry-After header is the SEO-correct way to signal a
// temporary outage so search engines don't de-index the site.
// -----------------------------------------------------------------------------
app.use((req, res, next) => {
  // Never gate the CMS, the legacy admin redirect, or the static/asset paths —
  // otherwise an admin could lock themselves out with no way back in.
  const p = req.path;
  if (
    p.startsWith('/sacxc-cms') ||
    p.startsWith('/admin') ||
    p.startsWith('/uploads') ||
    p.startsWith('/images') ||
    p.startsWith('/css') ||
    p.startsWith('/js') ||
    p.startsWith('/favicon') ||
    p.startsWith('/.well-known') ||
    p === '/robots.txt' ||
    p === '/sitemap.xml'
  ) return next();

  // Logged-in admin/editor users always see the live site (preview while in maintenance).
  if (req.session && req.session.user) return next();

  // Check the flag. res.locals.settings is populated by the settings middleware above.
  const on = res.locals.settings && res.locals.settings.maintenance_mode === '1';
  if (!on) return next();

  res.status(503);
  res.set('Retry-After', '3600');
  return res.render('pages/maintenance', { title: 'Under Maintenance', data: buildData(getDb()) });
});

// -----------------------------------------------------------------------------
// Anonymous full-page micro-cache.
//
// The public pages are identical for every logged-out visitor and only change
// when an admin edits content in the CMS. Rendering EJS + assembling buildData()
// on every single request is the main CPU cost under load. This middleware
// caches the fully-rendered HTML of public GET pages for a few seconds, keyed
// by path, and serves subsequent hits straight from memory. A burst of traffic
// to the same page (the "1M visits" scenario) is then served almost entirely
// from RAM, multiplying capacity many times over.
//
// Safety rules:
//   - Only GET, only anonymous (never cache a logged-in admin's view).
//   - Never cache the CMS, uploads, or anything with a query string.
//   - Skips when maintenance mode is on.
//   - Short TTL (default 15s) so edits appear quickly; the CMS can also call
//     app.locals.clearPageCache() after a save for instant freshness.
//   - Cache is size-bounded (LRU-ish by insertion) so it can't grow unbounded.
// -----------------------------------------------------------------------------
const PAGE_CACHE_TTL_MS = parseInt(process.env.PAGE_CACHE_TTL_MS) || 15000;
const PAGE_CACHE_MAX = 300;
const _pageCache = new Map(); // path -> { body, type, expires }

function clearPageCache() { _pageCache.clear(); }
app.locals.clearPageCache = clearPageCache;

app.use((req, res, next) => {
  // Only cache safe, anonymous, query-less public GETs.
  if (
    req.method !== 'GET' ||
    (req.session && req.session.user) ||
    Object.keys(req.query).length > 0 ||
    req.path.startsWith('/sacxc-cms') ||
    req.path.startsWith('/admin') ||
    req.path.startsWith('/api') ||
    req.path.startsWith('/uploads') ||
    req.path.startsWith('/images') ||
    req.path.startsWith('/css') ||
    req.path.startsWith('/js') ||
    req.path.startsWith('/vendor') ||
    req.path.startsWith('/favicon') ||
    req.path.includes('.')
  ) return next();

  // Don't serve cached pages while maintenance mode is on.
  if (res.locals.settings && res.locals.settings.maintenance_mode === '1') return next();

  const key = req.path;
  const hit = _pageCache.get(key);
  if (hit && hit.expires > Date.now()) {
    res.setHeader('Content-Type', hit.type);
    res.setHeader('X-Page-Cache', 'HIT');
    return res.status(200).send(hit.body);
  }

  // Miss — capture res.send output, store it, then continue.
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    try {
      if (res.statusCode === 200 && typeof body === 'string') {
        // Bound the cache size — drop the oldest entry when full.
        if (_pageCache.size >= PAGE_CACHE_MAX) {
          const oldest = _pageCache.keys().next().value;
          if (oldest !== undefined) _pageCache.delete(oldest);
        }
        _pageCache.set(key, {
          body,
          type: res.getHeader('Content-Type') || 'text/html; charset=utf-8',
          expires: Date.now() + PAGE_CACHE_TTL_MS,
        });
        res.setHeader('X-Page-Cache', 'MISS');
      }
    } catch (e) { /* never let caching break the response */ }
    return originalSend(body);
  };
  next();
});

// Routes
app.use('/', require('./routes/public'));
app.use('/sacxc-cms', require('./routes/admin'));

// Legacy /admin redirect to /sacxc-cms
app.use('/admin', (req, res) => res.redirect('/sacxc-cms' + req.path));

// robots.txt / sitemap / security.txt
app.get('/robots.txt', (req, res) => {
  const base = (req.protocol) + '://' + req.get('host');
  res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /sacxc-cms\nDisallow: /admin\nDisallow: /api\nDisallow: /uploads\n\nSitemap: ' + base + '/sitemap.xml\n');
});
app.get('/sitemap.xml', (req, res) => {
  const base = (process.env.SITE_URL) || (req.protocol + '://' + req.get('host'));
  const today = new Date().toISOString().slice(0,10);
  const pages = [
    ['', '1.0', 'weekly'], ['about', '0.9', 'monthly'], ['membership', '0.9', 'monthly'],
    ['services', '0.8', 'monthly'], ['our-members', '0.7', 'monthly'], ['governance', '0.6', 'monthly'],
    ['acxco', '0.6', 'monthly'], ['get-involved', '0.8', 'monthly']
  ];
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages.map(function(p){ return '  <url><loc>' + base + '/' + p[0] + '</loc><lastmod>' + today + '</lastmod><changefreq>' + p[2] + '</changefreq><priority>' + p[1] + '</priority></url>'; }).join('\n') +
    '\n</urlset>';
  res.type('application/xml').send(xml);
});
app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send('Contact: mailto:secretariat@sacxc.org\nPreferred-Languages: en\nExpires: 2027-01-01T00:00:00.000Z\n');
});

// 404
app.use((req, res) => res.status(404).render('pages/404', { title: 'Page Not Found', data: buildData(getDb()) }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('pages/error', { title: 'Server Error', error: err.message, data: buildData(getDb()) });
});

// -----------------------------------------------------------------------------
// Startup.
//
// Hostinger's Passenger wraps your app.js/server.js and calls app.listen() on
// its own socket. If we also call app.listen() we get the
// "http.Server.listen() was called more than once, ignore." warnings spammed
// into every log. So we detect Passenger and skip listen() in that case.
//
// Detection works because Passenger sets PASSENGER_APP_ENV, or we can check
// that process.env.PASSENGER_BASE_URI exists. We ALSO skip listen() if this
// module was required by another module (not run directly) — which is what
// Passenger does via its loader.
// -----------------------------------------------------------------------------
const isUnderPassenger =
  process.env.PASSENGER_APP_ENV !== undefined ||
  process.env.PASSENGER_BASE_URI !== undefined ||
  typeof process.env.PASSENGER_BIN !== 'undefined';

initDb().then(() => {
  // The DB is ready — build the real session middleware now. The placeholder
  // app.use() above will start delegating to it from here on.
  _sessionMw = buildSessionMiddleware();

  if (!isUnderPassenger && require.main === module) {
    app.listen(PORT, () => {
      console.log('\n  ╔══════════════════════════════════════════════════════╗');
      console.log('  ║  SACXC v10                                           ║');
      console.log('  ║  Website  → http://localhost:' + PORT + '                   ║');
      console.log('  ║  Admin    → http://localhost:' + PORT + '/sacxc-cms         ║');
      console.log('  ║  Login    → see data/FIRST_LOGIN.txt (first run)    ║');
      console.log('  ╚══════════════════════════════════════════════════════╝\n');
    });
  } else {
    console.log('[sacxc] Running under Passenger / as a required module — skipping app.listen().');
  }
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });

module.exports = app;
