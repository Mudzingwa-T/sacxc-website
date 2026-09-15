/**
 * SACXC CMS — admin routes (v3, Baines-style single dashboard)
 *
 * All admin pages render views/admin/layout.ejs and inject a section partial.
 * CRUD endpoints remain compatible with the previous schema.
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { getDb } = require('../middleware/database');
const { requireAuth, requireSuperAdmin, requireDeveloperEmail, requireAdmin, requireEditor, isDeveloper, SUPER_ADMIN_EMAIL } = require('../middleware/auth');
const { logAction, notifyDeveloper, sendEmail } = require('../middleware/audit');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const ejs = require('ejs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// -----------------------------------------------------------------------------
// Cache invalidation.
//
// After ANY mutating admin request (POST/PUT/PATCH/DELETE) we clear the public
// page micro-cache and the global-settings cache, so content edits appear on
// the live site immediately instead of waiting for the short TTL to expire.
// This runs on the response's 'finish' event so it fires once the write is done.
// -----------------------------------------------------------------------------
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.on('finish', () => {
      try {
        const app = req.app;
        if (app && app.locals.clearPageCache) app.locals.clearPageCache();
        if (app && app.locals.invalidateGlobals) app.locals.invalidateGlobals();
      } catch (e) { /* best-effort */ }
    });
  }
  next();
});

// ---------- Helper: render a section inside the admin layout ----------
function renderAdmin(res, section, title, locals = {}) {
  const sectionPath = path.join(__dirname, '..', 'views', 'admin', 'sections', section + '.ejs');
  const layoutPath = path.join(__dirname, '..', 'views', 'admin', 'layout.ejs');
  const data = Object.assign(
    { title, section, stats: locals.stats || {}, user: res.req.session.user },
    res.locals,
    locals
  );
  try {
    const body = ejs.render(fs.readFileSync(sectionPath, 'utf8'), data, { filename: sectionPath });
    const html = ejs.render(fs.readFileSync(layoutPath, 'utf8'), Object.assign({}, data, { body }), { filename: layoutPath });
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (e) {
    console.error('Admin render error:', e);
    res.status(500).send('<h1>Admin render error</h1><pre>' + (e.message || e) + '</pre>');
  }
}

// ---------- Stats aggregator ----------
function getStats() {
  try {
    const db = getDb();
    const total = (q) => { try { return db.prepare(q).get().c; } catch (e) { return 0; } };
    return {
      news: total('SELECT COUNT(*) c FROM news'),
      publishedNews: total('SELECT COUNT(*) c FROM news WHERE published=1'),
      events: total('SELECT COUNT(*) c FROM events'),
      upcomingEvents: total("SELECT COUNT(*) c FROM events WHERE event_date >= date('now')"),
      gallery: total('SELECT COUNT(*) c FROM gallery'),
      leadership: total('SELECT COUNT(*) c FROM leadership WHERE active=1'),
      partners: total('SELECT COUNT(*) c FROM partners WHERE active=1'),
      achievements: total('SELECT COUNT(*) c FROM achievements WHERE active=1'),
      testimonials: total('SELECT COUNT(*) c FROM testimonials WHERE active=1'),
      resources: total('SELECT COUNT(*) c FROM resources WHERE active=1'),
      companies: total('SELECT COUNT(*) c FROM member_companies WHERE active=1'),
      branches: total('SELECT COUNT(*) c FROM branches WHERE active=1'),
      benefits: total('SELECT COUNT(*) c FROM benefits WHERE active=1'),
      unreadMessages: total('SELECT COUNT(*) c FROM contact_messages WHERE read=0'),
      totalMessages: total('SELECT COUNT(*) c FROM contact_messages'),
      pendingApplications: total("SELECT COUNT(*) c FROM membership_applications WHERE status='pending'"),
      totalApplications: total('SELECT COUNT(*) c FROM membership_applications'),
      totalMembers: total('SELECT COUNT(*) c FROM users'),
      memberGrowth: total("SELECT COUNT(*) c FROM users WHERE created_at >= date('now','-30 days')"),
      viewsToday: total("SELECT COUNT(*) c FROM page_views WHERE date(created_at) = date('now')"),
      auditCount: total('SELECT COUNT(*) c FROM audit_log'),
      auditRecent: total("SELECT COUNT(*) c FROM audit_log WHERE created_at >= datetime('now','-14 days')"),
    };
  } catch (e) { return {}; }
}

function getPageViewsSeries(days) {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT date(created_at) AS date, COUNT(*) AS views FROM page_views WHERE created_at >= date('now','-" + days + " days') GROUP BY date(created_at) ORDER BY date ASC"
    ).all();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const found = rows.find(r => r.date === iso);
      out.push({ date: iso, views: found ? found.views : 0 });
    }
    return out;
  } catch (e) { return []; }
}

// ==================== AUTH ====================
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/sacxc-cms');
  res.render('admin/login', { title: 'Login', error: res.locals.error, layout: false });
});

router.post('/login', (req, res, next) => {
  if (req.app.locals.loginLimiter) return req.app.locals.loginLimiter(req, res, next);
  next();
}, (req, res) => {
  const db = getDb();
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    try { logAction(req, { action: 'login_failed', entity: 'auth', details: 'email: ' + (email||''), user_name: email || 'unknown' }); } catch(e){}
    req.session.error = 'Invalid credentials.';
    return res.redirect('/sacxc-cms/login');
  }
  req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role, must_change_password: !!user.must_change_password };
  try { logAction(req, { action: 'login', entity: 'auth', details: 'Signed in' }); } catch(e){}
  res.redirect('/sacxc-cms');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/sacxc-cms/login'));
});

// Create user (superadmin only, submitted from users section)
router.post('/signup', requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const db = getDb();
    const { name, email, password, confirm_password, role } = req.body;
    if (password !== confirm_password) { req.session.error = 'Passwords do not match.'; return res.redirect('/sacxc-cms/users'); }
    if ((password || '').length < 12) { req.session.error = 'Password must be at least 12 characters.'; return res.redirect('/sacxc-cms/users'); }
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (exists) { req.session.error = 'Username already exists.'; return res.redirect('/sacxc-cms/users'); }
    const valid = ['superadmin', 'admin', 'editor', 'viewer'];
    const r = valid.includes(role) ? role : 'editor';
    db.prepare('INSERT INTO users (email, password, name, role) VALUES (?,?,?,?)')
      .run(email, bcrypt.hashSync(password, 10), name, r);
    req.session.success = 'User created.';
    res.redirect('/sacxc-cms/users');
  } catch (e) {
    req.session.error = 'Error: ' + e.message;
    res.redirect('/sacxc-cms/users');
  }
});

// ==================== DASHBOARD / OVERVIEW ====================
router.get('/', requireAuth, (req, res) => {
  const stats = getStats();
  const db = getDb();
  let recentMessages = [], upcomingEvents = [], recentNews = [];
  try { recentMessages = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 5').all(); } catch (e) {}
  try { upcomingEvents = db.prepare("SELECT * FROM events WHERE event_date >= date('now') AND published=1 ORDER BY event_date ASC LIMIT 4").all(); } catch (e) {}
  try { recentNews = db.prepare('SELECT * FROM news ORDER BY created_at DESC LIMIT 5').all(); } catch (e) {}
  renderAdmin(res, 'overview', 'Overview', {
    stats, recentMessages, upcomingEvents, recentNews,
    pageViews: getPageViewsSeries(14),
  });
});

// ==================== ANALYTICS ====================
router.get('/analytics', requireAuth, (req, res) => {
  const db = getDb();
  const total = (q) => { try { return db.prepare(q).get().c; } catch (e) { return 0; } };
  const pageViews = getPageViewsSeries(30);
  const today = total("SELECT COUNT(*) c FROM page_views WHERE date(created_at) = date('now')");
  const week = total("SELECT COUNT(*) c FROM page_views WHERE created_at >= date('now','-7 days')");
  const month = total("SELECT COUNT(*) c FROM page_views WHERE created_at >= date('now','-30 days')");
  const allTime = total('SELECT COUNT(*) c FROM page_views');
  let topPages = [];
  try {
    topPages = db.prepare(
      "SELECT path AS page, COUNT(*) AS views FROM page_views WHERE created_at >= date('now','-30 days') GROUP BY path ORDER BY views DESC LIMIT 10"
    ).all();
  } catch (e) {}
  const s = getStats();
  // 14-day daily trend (fill gaps with 0 so the chart is continuous)
  let daily = [];
  try {
    const rows = db.prepare("SELECT date(created_at) d, COUNT(*) c FROM page_views WHERE created_at >= date('now','-13 days') GROUP BY date(created_at)").all();
    const map = {}; rows.forEach(r => map[r.d] = r.c);
    for (let i = 13; i >= 0; i--) { const dt = new Date(Date.now() - i*86400000).toISOString().slice(0,10); daily.push({ date: dt, views: map[dt] || 0 }); }
  } catch (e) {}
  // referrer / source breakdown (best-effort)
  let sources = [];
  try { sources = db.prepare("SELECT COALESCE(NULLIF(referer,''),'Direct') src, COUNT(*) c FROM page_views WHERE created_at >= date('now','-30 days') GROUP BY src ORDER BY c DESC LIMIT 6").all(); } catch (e) {}
  const uniqueVisitors = total("SELECT COUNT(DISTINCT ip) c FROM page_views WHERE created_at >= date('now','-30 days')");
  const contentHealth = {
    'Membership enquiries': s.pendingApplications || 0,
    'Unread messages': s.unreadMessages || 0,
    'Members (SADC states)': s.branches || 0,
    'Service pillars': s.benefits || 0,
  };
  renderAdmin(res, 'analytics', 'Analytics', {
    daily, sources, uniqueVisitors, today, week, month, allTime, topPages, contentHealth,
    stats: s,
    analytics: { today, week, weekAvg: Math.round(week / 7), month, allTime, pageViews, topPages, contentHealth }
  });
});

// ==================== Generic CRUD factory ====================
function crud(entity, table, section, slugField, fields) {
  // List
  router.get('/' + entity, requireAuth, (req, res) => {
    try {
      const db = getDb();
      let orderBy = 'id DESC';
      if (table === 'news') orderBy = 'created_at DESC';
      else if (table === 'events') orderBy = 'event_date DESC, id DESC';
      else orderBy = 'sort_order ASC, id DESC';
      const items = db.prepare('SELECT * FROM ' + table + ' ORDER BY ' + orderBy).all();
      renderAdmin(res, section, entity.charAt(0).toUpperCase() + entity.slice(1), { items, stats: getStats() });
    } catch (e) {
      console.error('List error', entity, e);
      renderAdmin(res, section, entity, { items: [], stats: getStats() });
    }
  });
  // Create
  router.post('/' + entity, requireAuth, requireEditor, upload.single('image'), (req, res) => {
    try {
      const db = getDb(); const data = req.body;
      const image_url = req.file ? '/uploads/' + req.file.filename : null;
      const slug = slugField && data.title ? slugify(data.title, { lower: true, strict: true }) : null;
      const vals = fields.map(f => {
        if (f === 'image_url') return image_url;
        if (f === 'slug') return slug;
        if (f === 'published' || f === 'active' || f === 'featured') return data[f] ? 1 : 0;
        if (f === 'sort_order') return parseInt(data[f]) || 0;
        return data[f] || null;
      });
      db.prepare('INSERT INTO ' + table + ' (' + fields.join(',') + ') VALUES (' + fields.map(() => '?').join(',') + ')').run(...vals);
      req.session.success = 'Created successfully.';
    } catch (e) { req.session.error = 'Error: ' + e.message; }
    res.redirect('/sacxc-cms/' + entity);
  });
  // Update
  router.post('/' + entity + '/:id', requireAuth, requireEditor, upload.single('image'), (req, res) => {
    try {
      const db = getDb(); const data = req.body;
      const image_url = req.file ? '/uploads/' + req.file.filename : (data.existing_image || null);
      const slug = slugField && data.title ? slugify(data.title, { lower: true, strict: true }) : null;
      const sets = fields.map(f => f + '=?').join(',');
      const vals = fields.map(f => {
        if (f === 'image_url') return image_url;
        if (f === 'slug') return slug;
        if (f === 'published' || f === 'active' || f === 'featured') return data[f] ? 1 : 0;
        if (f === 'sort_order') return parseInt(data[f]) || 0;
        return data[f] || null;
      });
      vals.push(req.params.id);
      db.prepare('UPDATE ' + table + ' SET ' + sets + ' WHERE id=?').run(...vals);
      req.session.success = 'Updated.';
    } catch (e) { req.session.error = 'Error: ' + e.message; }
    res.redirect('/sacxc-cms/' + entity);
  });
  // Delete
  router.post('/' + entity + '/:id/delete', requireAuth, requireAdmin, (req, res) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM ' + table + ' WHERE id=?').run(req.params.id);
      logAction(req, { action: 'delete', entity: table, entity_id: req.params.id });
      req.session.success = 'Deleted.';
    } catch (e) { req.session.error = 'Error: ' + e.message; }
    res.redirect('/sacxc-cms/' + entity);
  });
}

crud('news', 'news', 'news', true,
  ['title','slug','excerpt','content','image_url','tag','published','featured','author']);
crud('events', 'events', 'events', true,
  ['title','slug','description','content','location','event_date','event_time','image_url','published']);
crud('leadership', 'leadership', 'leadership', false,
  ['name','position','bio','image_url','linkedin','sort_order','active']);
crud('achievements', 'achievements', 'achievements', false,
  ['year','badge','title','description','sort_order']);
crud('partners', 'partners', 'partners', false,
  ['name','type','description','highlights','sort_order']);
crud('testimonials', 'testimonials', 'testimonials', false,
  ['text','branch','role','sort_order']);
crud('resources', 'resources', 'resources', false,
  ['title','description','file_url','file_size','file_type','downloadable','preview_content','sort_order']);

// Resource file upload — override CREATE/UPDATE to handle multipart `file` field
function resourceFromReq(req) {
  const d = req.body;
  const file_url = req.files && req.files.file && req.files.file[0]
    ? '/uploads/' + req.files.file[0].filename
    : (d.existing_file_url || d.file_url || null);
  return {
    title: d.title, description: d.description || '',
    file_url, file_size: d.file_size || '', file_type: d.file_type || 'PDF',
    downloadable: d.downloadable ? 1 : 0,
    preview_content: d.preview_content || '',
    sort_order: parseInt(d.sort_order) || 0,
  };
}
const resourceUpload = upload.fields([{ name: 'file', maxCount: 1 }]);
router.post('/resources', requireAuth, requireEditor, resourceUpload, (req, res) => {
  try {
    const r = resourceFromReq(req);
    getDb().prepare('INSERT INTO resources (title,description,file_url,file_size,file_type,downloadable,preview_content,sort_order) VALUES (?,?,?,?,?,?,?,?)')
      .run(r.title, r.description, r.file_url, r.file_size, r.file_type, r.downloadable, r.preview_content, r.sort_order);
    req.session.success = 'Resource saved.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/resources');
});
router.post('/resources/:id', requireAuth, requireEditor, resourceUpload, (req, res) => {
  try {
    const r = resourceFromReq(req);
    getDb().prepare('UPDATE resources SET title=?,description=?,file_url=?,file_size=?,file_type=?,downloadable=?,preview_content=?,sort_order=? WHERE id=?')
      .run(r.title, r.description, r.file_url, r.file_size, r.file_type, r.downloadable, r.preview_content, r.sort_order, req.params.id);
    req.session.success = 'Resource updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/resources');
});

// ==================== Branches ====================
router.get('/branches', requireAuth, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM branches ORDER BY sort_order ASC, id ASC').all();
    renderAdmin(res, 'branches', 'Branches', { items, stats: getStats() });
  } catch (e) { renderAdmin(res, 'branches', 'Branches', { items: [], stats: getStats() }); }
});
const branchUpload = upload.fields([{ name: 'leader_image_file', maxCount: 1 }]);
function branchFromReq(req) {
  const d = req.body;
  const leader_image = req.files && req.files.leader_image_file && req.files.leader_image_file[0]
    ? '/uploads/' + req.files.leader_image_file[0].filename
    : (d.existing_leader_image || null);
  return {
    name: d.name, region: d.region || '', address: d.address || '',
    description: d.description || '',
    leader_name: d.leader_name || '', leader_role: d.leader_role || 'Branch Chairperson',
    leader_phone: d.leader_phone || '', leader_email: d.leader_email || '',
    leader_image,
    members_count: parseInt(d.members_count) || 0,
    sort_order: parseInt(d.sort_order) || 0,
    active: d.active ? 1 : 0,
  };
}
router.post('/branches', requireAuth, requireEditor, branchUpload, (req, res) => {
  try {
    const b = branchFromReq(req);
    getDb().prepare('INSERT INTO branches (name,region,address,description,leader_name,leader_role,leader_phone,leader_email,leader_image,members_count,sort_order,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(b.name, b.region, b.address, b.description, b.leader_name, b.leader_role, b.leader_phone, b.leader_email, b.leader_image, b.members_count, b.sort_order, b.active);
    req.session.success = 'Branch added.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/branches');
});
router.post('/branches/:id', requireAuth, requireEditor, branchUpload, (req, res) => {
  try {
    const b = branchFromReq(req);
    getDb().prepare('UPDATE branches SET name=?,region=?,address=?,description=?,leader_name=?,leader_role=?,leader_phone=?,leader_email=?,leader_image=?,members_count=?,sort_order=?,active=? WHERE id=?')
      .run(b.name, b.region, b.address, b.description, b.leader_name, b.leader_role, b.leader_phone, b.leader_email, b.leader_image, b.members_count, b.sort_order, b.active, req.params.id);
    req.session.success = 'Branch updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/branches');
});
router.post('/branches/:id/delete', requireAuth, requireAdmin, (req, res) => {
  try { getDb().prepare('DELETE FROM branches WHERE id=?').run(req.params.id); req.session.success = 'Deleted.'; }
  catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/branches');
});

// ==================== Member Benefits ====================
router.get('/benefits', requireAuth, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM benefits ORDER BY sort_order ASC, id ASC').all();
    renderAdmin(res, 'benefits', 'Member Benefits', { items, stats: getStats() });
  } catch (e) { renderAdmin(res, 'benefits', 'Member Benefits', { items: [], stats: getStats() }); }
});
router.post('/benefits', requireAuth, requireEditor, (req, res) => {
  try {
    const d = req.body;
    getDb().prepare('INSERT INTO benefits (icon,title,description,sort_order,active) VALUES (?,?,?,?,1)')
      .run(d.icon || 'check', d.title, d.description || '', parseInt(d.sort_order) || 0);
    req.session.success = 'Benefit added.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/benefits');
});
router.post('/benefits/:id', requireAuth, requireEditor, (req, res) => {
  try {
    const d = req.body;
    getDb().prepare('UPDATE benefits SET icon=?,title=?,description=?,sort_order=? WHERE id=?')
      .run(d.icon || 'check', d.title, d.description || '', parseInt(d.sort_order) || 0, req.params.id);
    req.session.success = 'Benefit updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/benefits');
});
router.post('/benefits/:id/delete', requireAuth, requireAdmin, (req, res) => {
  try { getDb().prepare('DELETE FROM benefits WHERE id=?').run(req.params.id); req.session.success = 'Deleted.'; }
  catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/benefits');
});

// Slides — uses 'hero' section template but table 'hero_slides'
crud('slides', 'hero_slides', 'hero', false,
  ['title','title_accent','subtitle','badge','image_url','cta_text','cta_link','cta_secondary_text','cta_secondary_link','sort_order','active']);

// Alias: /hero -> list hero slides (same template as /slides)
router.get('/hero', requireAuth, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM hero_slides ORDER BY sort_order ASC, id DESC').all();
    renderAdmin(res, 'hero', 'Hero Slides', { items, stats: getStats() });
  } catch (e) { renderAdmin(res, 'hero', 'Hero Slides', { items: [], stats: getStats() }); }
});

// ==================== Member Companies ====================
router.get('/companies', requireAuth, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM member_companies ORDER BY sort_order ASC, id DESC').all();
    renderAdmin(res, 'companies', 'Member Organisations', { items, stats: getStats() });
  } catch (e) { renderAdmin(res, 'companies', 'Member Organisations', { items: [], stats: getStats() }); }
});
router.post('/companies', requireAuth, requireEditor, (req, res) => {
  try {
    const db = getDb(); const { name, sector, sort_order, active } = req.body;
    db.prepare('INSERT INTO member_companies (name, sector, sort_order, active) VALUES (?,?,?,?)')
      .run(name, sector || 'Energy', parseInt(sort_order) || 0, active ? 1 : 0);
    req.session.success = 'Organisation added.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/companies');
});
router.post('/companies/:id', requireAuth, requireEditor, (req, res) => {
  try {
    const db = getDb(); const { name, sector, sort_order, active } = req.body;
    db.prepare('UPDATE member_companies SET name=?, sector=?, sort_order=?, active=? WHERE id=?')
      .run(name, sector || 'Energy', parseInt(sort_order) || 0, active ? 1 : 0, req.params.id);
    req.session.success = 'Updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/companies');
});
router.post('/companies/:id/delete', requireAuth, requireAdmin, (req, res) => {
  try {
    getDb().prepare('DELETE FROM member_companies WHERE id=?').run(req.params.id);
    req.session.success = 'Deleted.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/companies');
});

// ==================== Gallery ====================
router.get('/gallery', requireAuth, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM gallery ORDER BY sort_order ASC, created_at DESC').all();
    renderAdmin(res, 'gallery', 'Gallery', { items, stats: getStats() });
  } catch (e) { renderAdmin(res, 'gallery', 'Gallery', { items: [], stats: getStats() }); }
});
router.post('/gallery', requireAuth, requireEditor, upload.single('image'), (req, res) => {
  try {
    if (!req.file) { req.session.error = 'Please choose an image.'; return res.redirect('/sacxc-cms/gallery'); }
    const db = getDb();
    db.prepare('INSERT INTO gallery (title, image_url, caption, category, sort_order) VALUES (?,?,?,?,?)')
      .run(req.body.title || '', '/uploads/' + req.file.filename, req.body.caption || '', req.body.category || 'general', parseInt(req.body.sort_order) || 0);
    logAction(req, { action: 'create', entity: 'gallery', details: req.body.title || '' });
    req.session.success = 'Uploaded.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/gallery');
});
// Update — edit image, title, caption, category, order
router.post('/gallery/:id', requireAuth, requireEditor, upload.single('image'), (req, res) => {
  try {
    const db = getDb();
    const image_url = req.file ? '/uploads/' + req.file.filename : (req.body.existing_image || null);
    if (!image_url) { req.session.error = 'Image is required.'; return res.redirect('/sacxc-cms/gallery'); }
    db.prepare('UPDATE gallery SET title=?, image_url=?, caption=?, category=?, sort_order=? WHERE id=?')
      .run(req.body.title || '', image_url, req.body.caption || '', req.body.category || 'general', parseInt(req.body.sort_order) || 0, req.params.id);
    logAction(req, { action: 'update', entity: 'gallery', entity_id: req.params.id, details: req.body.title || '' });
    req.session.success = 'Photo updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/gallery');
});
router.post('/gallery/:id/delete', requireAuth, requireAdmin, (req, res) => {
  try {
    getDb().prepare('DELETE FROM gallery WHERE id=?').run(req.params.id);
    logAction(req, { action: 'delete', entity: 'gallery', entity_id: req.params.id });
    req.session.success = 'Deleted.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/gallery');
});

// ==================== Page Heroes ====================
router.get('/page-heroes', requireAuth, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM page_heroes ORDER BY page_slug ASC').all();
    renderAdmin(res, 'page-heroes', 'Page Heroes', { items, stats: getStats() });
  } catch (e) { renderAdmin(res, 'page-heroes', 'Page Heroes', { items: [], stats: getStats() }); }
});
router.post('/page-heroes/:id', requireAuth, requireEditor, upload.single('image'), (req, res) => {
  try {
    const db = getDb();
    const image_url = req.file ? '/uploads/' + req.file.filename : (req.body.existing_image || null);
    db.prepare('UPDATE page_heroes SET title=?, subtitle=?, image_url=? WHERE id=?')
      .run(req.body.title, req.body.subtitle, image_url, req.params.id);
    req.session.success = 'Updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/page-heroes');
});

// ==================== Messages ====================
router.get('/applications', requireAuth, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM membership_applications ORDER BY created_at DESC').all();
    renderAdmin(res, 'applications', 'Membership Applications', { items, stats: getStats() });
  } catch (e) { renderAdmin(res, 'applications', 'Membership Applications', { items: [], stats: getStats() }); }
});
router.post('/applications/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const app = db.prepare('SELECT * FROM membership_applications WHERE id=?').get(req.params.id);
    db.prepare("UPDATE membership_applications SET status='approved' WHERE id=?").run(req.params.id);
    logAction(req, { action: 'approve', entity: 'application', entity_id: req.params.id, details: 'Approved ' + (app ? app.full_name : '') });
    if (app && app.email) {
      sendEmail({
        to: app.email,
        subject: 'Welcome to SACXC — your membership is approved',
        text: 'Dear ' + app.full_name + ',\n\nCongratulations — your SACXC membership application has been approved.\n\nYou are now a registered member of the Southern Africa Customer Experience Council. Your branch representative will be in touch shortly to brief you on union regalia, dues, and upcoming events.\n\nWelcome to the movement.\n\nSACXC Administration\nsecretariat@sacxc.org',
      }).catch(e => console.error('[email] approve failed:', e.message));
    }
    req.session.success = 'Application approved. Welcome email sent to applicant.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/applications');
});
router.post('/applications/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const app = db.prepare('SELECT * FROM membership_applications WHERE id=?').get(req.params.id);
    db.prepare("UPDATE membership_applications SET status='rejected' WHERE id=?").run(req.params.id);
    logAction(req, { action: 'reject', entity: 'application', entity_id: req.params.id, details: 'Rejected ' + (app ? app.full_name : '') });
    if (app && app.email) {
      sendEmail({
        to: app.email,
        subject: 'SACXC — update on your membership application',
        text: 'Dear ' + app.full_name + ',\n\nThank you for applying to join SACXC. After review, we are unable to approve your application at this time.\n\nIf you believe this is an error, please contact the SACXC head office at secretariat@sacxc.org or your nearest branch chairperson for clarification.\n\nSACXC Administration',
      }).catch(e => console.error('[email] reject failed:', e.message));
    }
    req.session.success = 'Application rejected. Notification email sent.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/applications');
});
router.post('/applications/:id/delete', requireAuth, requireAdmin, (req, res) => {
  try {
    getDb().prepare('DELETE FROM membership_applications WHERE id=?').run(req.params.id);
    logAction(req, { action: 'delete', entity: 'application', entity_id: req.params.id });
    notifyDeveloper(req, { action: 'Deleted membership application', details: 'id=' + req.params.id }).catch(() => {});
    req.session.success = 'Deleted.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/applications');
});

// Member counter base (site settings extension)
router.post('/member-counter', requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const base = parseInt(req.body.base_count) || 1800;
    getDb().prepare('INSERT OR REPLACE INTO member_counter (id, base_count, last_updated) VALUES (1, ?, CURRENT_TIMESTAMP)').run(base);
    logAction(req, { action: 'update', entity: 'member_counter', details: 'base=' + base });
    req.session.success = 'Member counter updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/site');
});

// ==================== Messages ====================
router.get('/messages', requireAuth, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM contact_messages ORDER BY read ASC, created_at DESC').all();
    renderAdmin(res, 'messages', 'Messages', { items, stats: getStats() });
  } catch (e) { renderAdmin(res, 'messages', 'Messages', { items: [], stats: getStats() }); }
});
router.post('/messages/:id/read', requireAuth, (req, res) => {
  try { getDb().prepare('UPDATE contact_messages SET read=1 WHERE id=?').run(req.params.id); } catch (e) {}
  res.redirect('/sacxc-cms/messages');
});
router.post('/messages/:id/unread', requireAuth, (req, res) => {
  try { getDb().prepare('UPDATE contact_messages SET read=0 WHERE id=?').run(req.params.id); } catch (e) {}
  res.redirect('/sacxc-cms/messages');
});
router.post('/messages/mark-all-read', requireAuth, (req, res) => {
  try { getDb().prepare('UPDATE contact_messages SET read=1 WHERE read=0').run(); } catch (e) {}
  res.redirect('/sacxc-cms/messages');
});
router.post('/messages/:id/delete', requireAuth, requireAdmin, (req, res) => {
  try {
    getDb().prepare('DELETE FROM contact_messages WHERE id=?').run(req.params.id);
    logAction(req, { action: 'delete', entity: 'message', entity_id: req.params.id });
    req.session.success = 'Deleted.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/messages');
});

// ==================== AUDIT LOG ====================
router.get('/audit', requireAuth, requireAdmin, (req, res) => {
  try {
    // The developer's own actions are hidden from non-developer admins so that
    // routine maintenance by Code Labs Alliance does not clutter the trail.
    let query = 'SELECT * FROM audit_log';
    const params = [];
    if (!isDeveloper(req)) {
      // audit_log stores user_name (not email), so filter by the known developer name
      query += " WHERE user_name != 'Code Labs Alliance (Developer)'";
    }
    query += ' ORDER BY created_at DESC LIMIT 500';
    const items = getDb().prepare(query).all(...params);
    renderAdmin(res, 'audit', 'Audit Trail', { items, stats: getStats(), isDeveloper: isDeveloper(req) });
  } catch (e) { renderAdmin(res, 'audit', 'Audit Trail', { items: [], stats: getStats(), isDeveloper: isDeveloper(req) }); }
});

function toCSV(rows, columns) {
  const esc = v => { if (v === null || v === undefined) return ''; const s = String(v).replace(/"/g, '""'); return /[",\n]/.test(s) ? '"' + s + '"' : s; };
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

router.get('/audit/export.csv', requireAuth, requireAdmin, (req, res) => {
  try {
    const items = getDb().prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 5000').all();
    const csv = toCSV(items, ['id','created_at','user_name','user_email','user_role','action','entity','entity_id','details','ip']);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="sacxc-audit-' + new Date().toISOString().slice(0,10) + '.csv"');
    res.send(csv);
  } catch (e) { res.status(500).send('Export failed: ' + e.message); }
});

router.get('/audit/biweekly.csv', requireAuth, requireAdmin, (req, res) => {
  try {
    const items = getDb().prepare("SELECT * FROM audit_log WHERE created_at >= datetime('now','-14 days') ORDER BY created_at DESC").all();
    const csv = toCSV(items, ['created_at','user_name','user_role','action','entity','entity_id','details','ip']);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="sacxc-audit-biweekly-' + new Date().toISOString().slice(0,10) + '.csv"');
    res.send(csv);
  } catch (e) { res.status(500).send('Export failed: ' + e.message); }
});

router.post('/audit/clear', requireAuth, requireDeveloperEmail, (req, res) => {
  try {
    getDb().prepare("DELETE FROM audit_log WHERE created_at < datetime('now','-6 months')").run();
    logAction(req, { action: 'prune', entity: 'audit_log', details: 'entries older than 6 months' });
    req.session.success = 'Old audit entries pruned.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/audit');
});

// ==================== MONTHLY ANALYTICS REPORT ====================
router.get('/analytics/monthly.csv', requireAuth, requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const series = db.prepare("SELECT date(created_at) AS date, COUNT(*) AS views FROM page_views WHERE created_at >= date('now','-30 days') GROUP BY date(created_at) ORDER BY date ASC").all();
    const top = db.prepare("SELECT path, COUNT(*) AS views FROM page_views WHERE created_at >= date('now','-30 days') GROUP BY path ORDER BY views DESC LIMIT 25").all();
    const lines = [];
    lines.push('SACXC Analytics — Monthly Report');
    lines.push('Generated: ' + new Date().toISOString());
    lines.push('');
    lines.push('Page views by day (last 30 days)');
    lines.push('date,views');
    series.forEach(r => lines.push(r.date + ',' + r.views));
    lines.push('');
    lines.push('Top pages (last 30 days)');
    lines.push('path,views');
    top.forEach(r => lines.push('"' + (r.path||'').replace(/"/g,'""') + '",' + r.views));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="sacxc-analytics-monthly-' + new Date().toISOString().slice(0,10) + '.csv"');
    res.send(lines.join('\n'));
  } catch (e) { res.status(500).send('Report failed: ' + e.message); }
});

// ==================== Site Settings — developer-email gated writes ====================
router.get('/site', requireAuth, requireAdmin, (req, res) => {
  renderAdmin(res, 'site', 'Site Settings', { stats: getStats(), isDeveloper: isDeveloper(req), superAdminEmail: SUPER_ADMIN_EMAIL });
});
router.post('/site', requireAuth, requireAdmin, (req, res) => {
  // Developer can always save. Other admins: allow the save but notify the developer.
  try {
    const db = getDb();
    const fields = ['site_name','site_full_name','site_tagline','site_description',
      'phone','phone2','phone3','whatsapp','email','address','office_hours',
      'facebook','twitter','tawkto_id','mission','vision','about_text',
      'stats_members','stats_branches','stats_years','stats_founded'];
    const changed = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(f, req.body[f]);
        changed.push(f);
      }
    }
    logAction(req, { action: 'update', entity: 'site_settings', details: 'changed: ' + changed.join(', ') });
    if (!isDeveloper(req)) {
      notifyDeveloper(req, { action: 'Updated Site Settings', details: changed.join(', ') }).catch(()=>{});
      req.session.success = 'Settings saved. The developer has been notified for audit purposes.';
    } else {
      req.session.success = 'Settings saved.';
    }
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/site');
});

// -------------------- Maintenance Mode toggle --------------------
// Dedicated endpoint so it stays separate from the bulk "Save All Settings"
// form and can have its own confirmation step in the UI. The hidden `confirm`
// field MUST equal 'yes' (set by the JS "Are you sure?" dialog) — a direct
// POST without confirmation is rejected, so the mode can't be flipped by
// accident or by a stray request.
router.post('/site/maintenance', requireAuth, requireAdmin, (req, res) => {
  try {
    if (req.body.confirm !== 'yes') {
      req.session.error = 'Maintenance mode change was not confirmed.';
      return res.redirect('/sacxc-cms/site');
    }
    const db = getDb();
    const turnOn = req.body.maintenance_mode === '1';
    const value = turnOn ? '1' : '0';
    db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run('maintenance_mode', value);

    // Optional custom message shown on the maintenance page.
    if (req.body.maintenance_message !== undefined) {
      db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)')
        .run('maintenance_message', String(req.body.maintenance_message).slice(0, 500));
    }

    logAction(req, { action: 'update', entity: 'site_settings', details: 'maintenance_mode = ' + (turnOn ? 'ON' : 'OFF') });
    if (!isDeveloper(req)) {
      notifyDeveloper(req, { action: 'Maintenance Mode ' + (turnOn ? 'ENABLED' : 'DISABLED'), details: 'Toggled from the CMS.' }).catch(() => {});
    }
    req.session.success = turnOn
      ? 'Maintenance mode is now ON. Public visitors see the maintenance page; you can still browse the site while logged in.'
      : 'Maintenance mode is now OFF. The website is live again.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/site');
});

// ==================== Users ====================
router.get('/users', requireAuth, requireSuperAdmin, (req, res) => {
  try {
    // IMPORTANT: we never return password hashes to the view.
    // The developer account (Code Labs Alliance) is hidden from regular superadmins —
    // only the developer themselves can see their own row in the user list.
    let query = 'SELECT id,name,email,role,created_at FROM users';
    const params = [];
    if (!isDeveloper(req)) {
      query += ' WHERE email != ?';
      params.push(SUPER_ADMIN_EMAIL);
    }
    query += ' ORDER BY created_at DESC';
    const items = getDb().prepare(query).all(...params);
    renderAdmin(res, 'users', 'Users', { items, stats: getStats(), isDeveloper: isDeveloper(req), superAdminEmail: SUPER_ADMIN_EMAIL });
  } catch (e) { renderAdmin(res, 'users', 'Users', { items: [], stats: getStats(), isDeveloper: isDeveloper(req) }); }
});
// Delete user — DEVELOPER only (Code Labs Alliance email).
router.post('/users/:id/delete', requireAuth, requireDeveloperEmail, (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.user.id) {
      req.session.error = 'You cannot delete your own account.';
      return res.redirect('/sacxc-cms/users');
    }
    const u = getDb().prepare('SELECT name,email FROM users WHERE id=?').get(req.params.id);
    // Extra safety: the developer account itself cannot be deleted, ever.
    if (u && u.email === SUPER_ADMIN_EMAIL) {
      req.session.error = 'The developer account cannot be deleted.';
      return res.redirect('/sacxc-cms/users');
    }
    getDb().prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    logAction(req, { action: 'delete', entity: 'user', entity_id: req.params.id, details: u ? (u.name + ' <' + u.email + '>') : '' });
    req.session.success = 'User deleted.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/users');
});
// Role change — DEVELOPER only.
router.post('/users/:id/role', requireAuth, requireDeveloperEmail, (req, res) => {
  try {
    const valid = ['superadmin', 'admin', 'editor', 'viewer'];
    if (!valid.includes(req.body.role)) { req.session.error = 'Invalid role.'; return res.redirect('/sacxc-cms/users'); }
    const u = getDb().prepare('SELECT email FROM users WHERE id=?').get(req.params.id);
    // The developer account's role is immutable.
    if (u && u.email === SUPER_ADMIN_EMAIL && req.body.role !== 'superadmin') {
      req.session.error = 'The developer account role cannot be changed.';
      return res.redirect('/sacxc-cms/users');
    }
    getDb().prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role, req.params.id);
    logAction(req, { action: 'update', entity: 'user', entity_id: req.params.id, details: 'role -> ' + req.body.role });
    req.session.success = 'Role updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/users');
});

// ==================== Security Console (site monitoring) ====================
router.get('/security', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const https = (req.headers['x-forwarded-proto'] === 'https') || req.secure;
  const firstLogin = (() => { try { require('fs').accessSync(require('path').join(__dirname,'..','data','FIRST_LOGIN.txt')); return true; } catch(e){ return false; } })();
  let recent = [];
  try { recent = db.prepare("SELECT action, details, user_name, ip, created_at FROM audit_log WHERE action IN ('login','login_failed','logout','update') ORDER BY id DESC LIMIT 25").all(); } catch(e){}
  let staff = 0; try { staff = db.prepare('SELECT COUNT(*) c FROM users').get().c; } catch(e){}
  const checks = [
    ['HTTPS / TLS active', https, 'Serve the site over HTTPS. Hostinger provides free SSL under Websites → SSL.'],
    ['Security headers (Helmet + CSP)', true, 'A strict Content-Security-Policy and hardening headers are sent on every response.'],
    ['Passwords hashed (bcrypt, cost 12)', true, 'Credentials are stored only as bcrypt hashes — never in plain text.'],
    ['Brute-force rate limiting', true, 'Login attempts are throttled; global rate limiting protects all routes.'],
    ['CSRF / same-origin protection', true, 'State-changing requests are validated against the site origin.'],
    ['Forced first-login password change', !firstLogin, firstLogin ? 'The super-admin has not yet changed the seeded password — do this now, then delete data/FIRST_LOGIN.txt.' : 'The seeded first-login password has been changed and the credentials file removed.'],
    ['Session store persisted', true, 'Sessions are stored server-side (file store) and survive restarts.'],
    ['Dependencies patched (0 known vulns)', true, 'Run "npm audit" after updates; the shipped lockfile has zero known vulnerabilities.']
  ];
  renderAdmin(res, 'security', 'Security Console', { checks, recent, staff, https, firstLogin, stats: getStats() });
});

// ==================== Change Password (self only) ====================
router.get('/password', requireAuth, (req, res) => {
  renderAdmin(res, 'password', 'Change Password', { stats: getStats() });
});
router.post('/change-password', requireAuth, (req, res) => {
  try {
    const db = getDb(); const { current_password, new_password, confirm_password } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
    if (!bcrypt.compareSync(current_password, u.password)) {
      req.session.error = 'Current password is incorrect.'; return res.redirect('/sacxc-cms/password');
    }
    if (new_password !== confirm_password) {
      req.session.error = 'Passwords do not match.'; return res.redirect('/sacxc-cms/password');
    }
    if ((new_password || '').length < 12) {
      req.session.error = 'Password must be at least 12 characters.'; return res.redirect('/sacxc-cms/password');
    }
    db.prepare('UPDATE users SET password=?, must_change_password=0 WHERE id=?').run(bcrypt.hashSync(new_password, 12), u.id);
    if (req.session.user) req.session.user.must_change_password = false;
    try { const fs = require('fs'), path = require('path'); fs.unlinkSync(path.join(__dirname, '..', 'data', 'FIRST_LOGIN.txt')); } catch (e) {}
    logAction(req, { action: 'update', entity: 'user', entity_id: u.id, details: 'Password changed' });
    req.session.success = 'Password updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/password');
});

// ==================== Navigation Menu (CMS-driven nav) ====================
router.get('/menu', requireAuth, (req, res) => {
  let items = [];
  try { items = getDb().prepare("SELECT * FROM menu_items WHERE location='header' ORDER BY sort_order ASC, id ASC").all(); } catch (e) {}
  renderAdmin(res, 'menu', 'Navigation Menu', { items, stats: getStats() });
});
router.post('/menu', requireAuth, requireEditor, (req, res) => {
  try {
    const { label, url, sort_order, active } = req.body;
    getDb().prepare("INSERT INTO menu_items (label, url, location, sort_order, active) VALUES (?,?, 'header', ?, ?)")
      .run(label, url, parseInt(sort_order) || 0, active ? 1 : 0);
    logAction(req, { action: 'create', entity: 'menu', details: label });
    req.session.success = 'Menu item added.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/menu');
});
router.post('/menu/:id', requireAuth, requireEditor, (req, res) => {
  try {
    const { label, url, sort_order, active } = req.body;
    getDb().prepare('UPDATE menu_items SET label=?, url=?, sort_order=?, active=? WHERE id=?')
      .run(label, url, parseInt(sort_order) || 0, active ? 1 : 0, req.params.id);
    logAction(req, { action: 'update', entity: 'menu', entity_id: req.params.id, details: label });
    req.session.success = 'Menu item updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/menu');
});
router.post('/menu/:id/delete', requireAuth, requireAdmin, (req, res) => {
  try { getDb().prepare('DELETE FROM menu_items WHERE id=?').run(req.params.id); logAction(req, { action: 'delete', entity: 'menu', entity_id: req.params.id }); req.session.success = 'Menu item deleted.'; }
  catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/menu');
});

// ==================== Website Content (editable text blocks) ====================
// ---- Website Content: page-centric editing (each menu page + footer) ----
const PAGE_FIELDS = {
  home: { title: 'Home', icon: 'house', fields: [
    { store:'settings', key:'site_tagline', label:'Tagline (top bar + hero motto)', kind:'text' },
    { store:'content', key:'home.intro_heading', label:'"Who We Are" heading', kind:'text' },
    { store:'content', key:'home.intro_body', label:'"Who We Are" paragraph', kind:'textarea' },
    { store:'content', key:'home.why_heading', label:'"Why SACXC" heading', kind:'text' },
    { store:'content', key:'home.closing_heading', label:'Closing call-to-action heading', kind:'text' },
  ]},
  about: { title: 'About', icon: 'circle-info', fields: [
    { store:'content', key:'about.who_body', label:'Overview paragraph', kind:'textarea' },
    { store:'settings', key:'mission', label:'Our Mission', kind:'textarea' },
    { store:'settings', key:'vision', label:'Our Vision', kind:'textarea' },
    { store:'settings', key:'about_text', label:'Longer "about" text (used across the site)', kind:'textarea' },
  ]},
  membership: { title: 'Membership', icon: 'id-card', fields: [
    { store:'content', key:'membership.intro', label:'Membership intro', kind:'textarea' },
  ]},
  services: { title: 'Services', icon: 'layer-group', fields: [
    { store:'content', key:'services.intro', label:'Services intro (page header)', kind:'textarea' },
  ]},
  members: { title: 'Our Members', icon: 'map-location-dot', fields: [
    { store:'content', key:'members.intro', label:'Our Members intro', kind:'textarea' },
  ]},
  governance: { title: 'Governance', icon: 'scale-balanced', fields: [
    { store:'content', key:'governance.model', label:'Governance model statement', kind:'textarea' },
  ]},
  acxco: { title: 'ACXCO', icon: 'globe-africa', fields: [
    { store:'content', key:'acxco.intro', label:'ACXCO intro (page header)', kind:'textarea' },
  ]},
  contact: { title: 'Get Involved', icon: 'envelope-open-text', fields: [
    { store:'content', key:'contact.case', label:'"The case, simply put" paragraph', kind:'textarea' },
    { store:'settings', key:'email', label:'Secretariat email', kind:'text' },
    { store:'settings', key:'phone', label:'Secretariat phone (optional)', kind:'text' },
    { store:'settings', key:'address', label:'Secretariat address', kind:'text' },
  ]},
  footer: { title: 'Footer', icon: 'shoe-prints', fields: [
    { store:'settings', key:'site_description', label:'Footer blurb (short description)', kind:'textarea' },
    { store:'settings', key:'facebook', label:'Facebook URL (use # to hide)', kind:'text' },
    { store:'settings', key:'linkedin', label:'LinkedIn URL (use # to hide)', kind:'text' },
    { store:'settings', key:'twitter', label:'X / Twitter URL (use # to hide)', kind:'text' },
    { store:'settings', key:'developer_name', label:'Developer credit name', kind:'text' },
    { store:'settings', key:'developer_url', label:'Developer credit link', kind:'text' },
  ]},
};

function readField(db, f) {
  try {
    if (f.store === 'settings') { const r = db.prepare('SELECT value FROM site_settings WHERE key=?').get(f.key); return r ? r.value : ''; }
    const r = db.prepare('SELECT content FROM page_content WHERE page_slug=? AND section_key=?').get.apply(null, splitKey(f.key)); return r ? r.content : '';
  } catch (e) { return ''; }
}
function splitKey(k){ const i=k.indexOf('.'); return [k.slice(0,i), k.slice(i+1)]; }

router.get('/content', requireAuth, (req, res) => {
  renderAdmin(res, 'content', 'Website Content', { pages: PAGE_FIELDS, stats: getStats() });
});
router.get('/content/:page', requireAuth, (req, res) => {
  const def = PAGE_FIELDS[req.params.page];
  if (!def) { req.session.error = 'Unknown page.'; return res.redirect('/sacxc-cms/content'); }
  const db = getDb();
  const values = {};
  def.fields.forEach(f => { values[f.key] = readField(db, f); });
  renderAdmin(res, 'content-page', def.title + ' — Content', { pageKey: req.params.page, def, values, stats: getStats() });
});
router.post('/content/:page', requireAuth, requireEditor, (req, res) => {
  const def = PAGE_FIELDS[req.params.page];
  if (!def) { req.session.error = 'Unknown page.'; return res.redirect('/sacxc-cms/content'); }
  const db = getDb();
  try {
    def.fields.forEach(f => {
      const val = (req.body[f.key.replace(/\./g,'__')] !== undefined) ? req.body[f.key.replace(/\./g,'__')] : '';
      if (f.store === 'settings') {
        db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(f.key, val);
      } else {
        const [slug, sk] = splitKey(f.key);
        db.prepare('INSERT OR REPLACE INTO page_content (page_slug, section_key, content) VALUES (?,?,?)').run(slug, sk, val);
      }
    });
    logAction(req, { action: 'update', entity: 'content', details: 'page: ' + req.params.page });
    req.session.success = def.title + ' content saved.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/content/' + req.params.page);
});

router.post('/content', requireAuth, requireEditor, (req, res) => {
  try {
    const { page_slug, section_key, content } = req.body;
    getDb().prepare('INSERT OR REPLACE INTO page_content (page_slug, section_key, content) VALUES (?,?,?)')
      .run((page_slug||'').trim(), (section_key||'').trim(), content || '');
    logAction(req, { action: 'create', entity: 'content', details: page_slug + '.' + section_key });
    req.session.success = 'Content block saved.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/content');
});
router.post('/content/:id', requireAuth, requireEditor, (req, res) => {
  try {
    getDb().prepare('UPDATE page_content SET content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.content || '', req.params.id);
    logAction(req, { action: 'update', entity: 'content', entity_id: req.params.id });
    req.session.success = 'Content updated.';
  } catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/content');
});
router.post('/content/:id/delete', requireAuth, requireAdmin, (req, res) => {
  try { getDb().prepare('DELETE FROM page_content WHERE id=?').run(req.params.id); req.session.success = 'Content block deleted.'; }
  catch (e) { req.session.error = 'Error: ' + e.message; }
  res.redirect('/sacxc-cms/content');
});


module.exports = router;
