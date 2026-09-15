const express = require('express');
const router = express.Router();
const { getDb } = require('../middleware/database');
const { buildData } = require('../lib/site-data');

function D() { return buildData(getDb()); }
const SADC = ['Angola','Botswana','Comoros','DR Congo','Eswatini','Lesotho','Madagascar','Malawi','Mauritius','Mozambique','Namibia','Seychelles','South Africa','Tanzania','Zambia','Zimbabwe'];

router.get('/',            (req, res) => res.render('pages/home',       { page:'home',       data: D(), preloadImage:'/images/hero-1.jpg' }));
router.get('/about',       (req, res) => res.render('pages/about',      { page:'about',      data: D() }));
router.get('/services',    (req, res) => res.render('pages/services',   { page:'services',   data: D() }));
router.get('/our-members', (req, res) => res.render('pages/members',    { page:'members',    data: D() }));
router.get('/governance',  (req, res) => res.render('pages/governance', { page:'governance', data: D() }));
router.get('/acxco',       (req, res) => res.render('pages/acxco',      { page:'acxco',      data: D() }));
router.get('/membership',  (req, res) => res.render('pages/membership', { page:'membership', data: D(), sadc: SADC, success:false }));
router.get('/get-involved',(req, res) => res.render('pages/contact',    { page:'contact',    data: D(), sadc: SADC }));
router.get('/contact',     (req, res) => res.render('pages/contact',    { page:'contact',    data: D(), sadc: SADC }));

// ---- Membership / partnership enquiry ----
router.post('/membership/apply', (req, res) => {
  const { full_name, email, phone, employer, branch, job_title, patterson_grade } = req.body;
  if (!full_name || !email || !employer || !patterson_grade || !branch) {
    req.session.error = 'Please fill in all required fields.';
    return res.redirect('/membership#apply');
  }
  try {
    const db = getDb();
    db.prepare('INSERT INTO membership_applications (full_name, email, phone, employer, branch, job_title, patterson_grade, signed_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(full_name, email, phone || '', employer, branch || '', job_title || '', patterson_grade || '', new Date().toISOString());
  } catch (e) { console.error('Application error:', e); }
  res.render('pages/membership', { page:'membership', data: D(), sadc: SADC, success:true });
});

// ---- Contact message ----
router.post('/contact', (req, res) => {
  const { first_name, last_name, email, subject, message } = req.body;
  if (!first_name || !last_name || !email || !message) {
    req.session.error = 'Please fill in all required fields.';
    return res.redirect('/get-involved');
  }
  try {
    getDb().prepare('INSERT INTO contact_messages (first_name, last_name, email, subject, message) VALUES (?,?,?,?,?)')
      .run(first_name, last_name, email, subject || 'General Inquiry', message);
    req.session.success = 'Thank you — your message has reached the SACXC Secretariat.';
  } catch (e) { req.session.error = 'Something went wrong. Please try again.'; }
  res.redirect('/get-involved');
});

// ---- Live member count API (kept) ----
router.get('/api/member-count', (req, res) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT base_count FROM member_counter WHERE id=1').get();
    const base = c ? c.base_count : 21;
    const approved = db.prepare("SELECT COUNT(*) c FROM membership_applications WHERE status='approved'").get();
    res.set('Cache-Control','no-store').json({ count: base + (approved ? approved.c : 0), base });
  } catch (e) { res.json({ count: 21 }); }
});

module.exports = router;
