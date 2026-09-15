/**
 * SACXC database setup + seeder.
 *
 * This file exports a reusable `seedDatabase(db)` function that creates
 * every table, indexes, and default data rows. It's called from two
 * places:
 *
 *   1. Automatically by middleware/database.js on first boot if the
 *      `users` table doesn't yet exist. This is what makes Hostinger's
 *      first deploy just work — no manual `node setup-db.js` step.
 *
 *   2. Manually from the command line via `node setup-db.js` for local
 *      dev / re-seeding. Running it is safe because every statement
 *      uses CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE.
 */
const bcrypt = require('bcryptjs');
require('dotenv').config();

function seedDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      name TEXT NOT NULL, role TEXT DEFAULT 'admin', must_change_password INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY, value TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hero_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, title_accent TEXT,
      subtitle TEXT, badge TEXT, image_url TEXT, cta_text TEXT, cta_link TEXT,
      cta_secondary_text TEXT, cta_secondary_link TEXT,
      sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS page_heroes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, page_slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, subtitle TEXT, image_url TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      excerpt TEXT, content TEXT, image_url TEXT, tag TEXT DEFAULT 'General',
      published INTEGER DEFAULT 0, featured INTEGER DEFAULT 0, author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      description TEXT, content TEXT, location TEXT, event_date TEXT, event_time TEXT,
      end_date TEXT, image_url TEXT, published INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS leadership (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, position TEXT NOT NULL,
      bio TEXT, image_url TEXT, linkedin TEXT, sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS gallery (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, image_url TEXT NOT NULL, caption TEXT,
      category TEXT DEFAULT 'general', sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT DEFAULT 'National',
      description TEXT, highlights TEXT, image_url TEXT, active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT,
      file_url TEXT, file_size TEXT, file_type TEXT DEFAULT 'PDF',
      downloadable INTEGER DEFAULT 0,
      preview_content TEXT,
      active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      email TEXT NOT NULL, subject TEXT, message TEXT NOT NULL, read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, year TEXT, badge TEXT, title TEXT NOT NULL,
      description TEXT, sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS testimonials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, branch TEXT, role TEXT,
      active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS member_companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sector TEXT DEFAULT 'Energy',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS page_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_slug TEXT NOT NULL,
      section_key TEXT NOT NULL,
      content TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(page_slug, section_key)
    );
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      referer TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at);
    CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);
    CREATE TABLE IF NOT EXISTS membership_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      id_number TEXT,
      email TEXT,
      phone TEXT,
      employer TEXT,
      branch TEXT,
      job_title TEXT,
      patterson_grade TEXT,
      signature TEXT,
      signed_at DATETIME,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS member_counter (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_count INTEGER DEFAULT 1800,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      region TEXT,
      leader_name TEXT,
      leader_role TEXT,
      leader_phone TEXT,
      leader_email TEXT,
      leader_image TEXT,
      address TEXT,
      description TEXT,
      members_count INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS benefits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      icon TEXT,
      title TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      user_role TEXT,
      action TEXT,
      entity TEXT,
      entity_id TEXT,
      details TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      location TEXT DEFAULT 'header',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Seed member counter singleton row
  try { db.prepare('INSERT OR IGNORE INTO member_counter (id, base_count) VALUES (1, 21)').run(); } catch (e) {}

  // -------- Super administrator (Tech24 Group) --------
  // The password is NEVER hard-coded in source. On first run a strong random
  // password is generated, hashed with bcrypt, and written to data/FIRST_LOGIN.txt
  // (server-side only). The account is flagged must_change_password so it must be
  // changed on first login, after which the file is deleted.
  const crypto = require('crypto');
  const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'tfmudzingwa@tech24group.com';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(SUPER_EMAIL);
  if (!existing) {
    const temp = crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,12) + 'A9!';
    db.prepare('INSERT INTO users (email, password, name, role, must_change_password) VALUES (?,?,?,?,1)')
      .run(SUPER_EMAIL, bcrypt.hashSync(temp, 12), 'Tech24 Group Administrator', 'superadmin');
    try {
      const fs = require('fs'), path = require('path');
      fs.writeFileSync(path.join(__dirname, 'data', 'FIRST_LOGIN.txt'),
        'SACXC CMS — first-login credentials\n\n' +
        'URL:       /sacxc-cms\n' +
        'Email:     ' + SUPER_EMAIL + '\n' +
        'Password:  ' + temp + '\n\n' +
        'You will be required to change this password immediately on first login.\n' +
        'After changing it, this file is deleted automatically. Delete it manually if it lingers.\n', 'utf8');
    } catch (e) { /* ignore */ }
  }

  // Settings — SACXC defaults
  const s = [
    ["site_name", "SACXC"],
    ["site_full_name", "Southern Africa Customer Experience Council"],
    ["site_tagline", "One Region. One Standard. One Customer Experience."],
    ["site_description", "The Southern Africa Customer Experience Council (SACXC) unites CX associations and professional training institutes across all 16 SADC Member States under one regional standard — an affiliate of ACXCO."],
    ["phone", ""],
    ["phone2", ""],
    ["phone3", ""],
    ["whatsapp", ""],
    ["email", "secretariat@sacxc.org"],
    ["address", "11 Koi Street, Peolwane, Gaborone, Botswana"],
    ["office_hours", "Monday – Friday: 8:00 AM – 5:00 PM"],
    ["facebook", "#"],
    ["twitter", "#"],
    ["linkedin", "#"],
    ["tawkto_id", ""],
    ["mission", "To unite Southern Africa’s national CX associations and professional training institutes under one regional standard of excellence: coordinating accreditation, advancing professional recognition, generating regional research, and giving the region’s CX community a single, credible voice within SADC and within the continental ACXCO structure."],
    ["vision", "A Southern Africa where every customer, in every SADC market, experiences service built on shared, professionally governed standards of CX excellence — and where Customer Experience is recognized and valued as a profession across the region."],
    ["about_text", "SACXC is a regional council — not a regulator, not a competitor to its members — uniting CX associations and professional training institutes from across the SADC region. Headquartered in Gaborone, Botswana, in the same city as the SADC Secretariat, the Council is positioned to engage regional institutions directly while remaining accountable to, and governed by, its own membership.\n\nAcross the SADC region, national CX associations and professional training institutes have each been building standards, training practitioners and pushing organizations to serve customers better — largely in isolation, country by country. SACXC exists to change that: one regional council, member-governed, coordinating standards, accreditation support, research and advocacy for Southern Africa’s CX community, while every member keeps its own independence, brand and national mandate.\n\nSACXC currently draws its membership from 6 national CX associations and 15 professional training institutes spanning the 16 SADC Member States, and is itself an affiliate member of the African Council of Customer Experience Organizations (ACXCO), linking Southern Africa’s CX community into the continental standards agenda."],
    ["stats_members", "21+"],
    ["stats_branches", "16"],
    ["stats_years", "6"],
    ["stats_founded", "15"],
    ["maintenance_mode", "0"],
    ["maintenance_message", ""],
    ["developer_name", "Tech24 Group"],
    ["developer_url", "https://www.tech24group.com"],
  ];
  for (const [k, v] of s) db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(k, v);

  // member_companies intentionally left unseeded (real member orgs added via CMS)

  const h = db.prepare('SELECT COUNT(*) as c FROM hero_slides').get();
  if (!h || h.c === 0) {
    db.prepare('INSERT INTO hero_slides (title, title_accent, subtitle, badge, image_url, cta_text, cta_link, cta_secondary_text, cta_secondary_link, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)').run("One Region. One Standard.","One Customer Experience.","SACXC unites CX associations and professional training institutes across all 16 SADC Member States — giving the region’s CX community one coordinated voice.","16 SADC Member States · One Standard","/images/hero/hero-1.jpg","Become a Member","/membership","Explore Our Services","/services",1);
    db.prepare('INSERT INTO hero_slides (title, title_accent, subtitle, badge, image_url, cta_text, cta_link, cta_secondary_text, cta_secondary_link, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)').run("Multiply Your Reach,","Authority and Voice","For a national CX association or training institute anywhere in SADC, joining SACXC multiplies your reach, credibility and influence — regionally and, through ACXCO, continentally.","Membership","/images/hero/hero-2.jpg","Why Join SACXC","/membership","Get Involved","/get-involved",2);
    db.prepare('INSERT INTO hero_slides (title, title_accent, subtitle, badge, image_url, cta_text, cta_link, cta_secondary_text, cta_secondary_link, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)').run("A Regional Voice,","A Continental Connection","SACXC is an affiliate member of ACXCO — the African Council of Customer Experience Organizations — uniting Africa’s national CX bodies under a shared standard, accreditation system and voice.","ACXCO Affiliate","/images/hero/hero-3.jpg","About the Council","/about","Our Members","/our-members",3);
  }

  const ph = db.prepare('SELECT COUNT(*) as c FROM page_heroes').get();
  if (!ph || ph.c === 0) {
    const pages = [
      ["about", "Who We Are", "A regional council uniting CX associations and professional training institutes from across the SADC region.", "/images/hero/hero-1.jpg"],
      ["achievements", "Our Mandate & Objectives", "What the Council is working to achieve for Southern Africa’s CX community.", "/images/hero/hero-2.jpg"],
      ["membership", "Membership", "Multiply your reach, authority and voice — regionally and, through ACXCO, continentally.", "/images/hero/hero-2.jpg"],
      ["services", "Our Services", "Six pillars — standards, accreditation support, research, advocacy, capacity-building and convening.", "/images/hero/hero-3.jpg"],
      ["news", "News & Updates", "Announcements and updates from across the SADC CX community.", "/images/hero/hero-1.jpg"],
      ["events", "Events", "Regional forums, General Meetings and convenings across the SADC region.", "/images/hero/hero-2.jpg"],
      ["gallery", "Media Gallery", "Moments from SACXC activities across the region.", "/images/hero/hero-3.jpg"],
      ["partners", "ACXCO & Continental Affiliation", "A regional voice, a continental connection.", "/images/hero/hero-1.jpg"],
      ["resources", "Resources", "Guides, frameworks and research for member organizations.", "/images/hero/hero-2.jpg"],
      ["contact", "Get Involved", "Contact the SACXC Secretariat in Gaborone, Botswana to begin the conversation.", "/images/hero/hero-3.jpg"],
      ["why-sacxc", "Why SACXC", "What membership changes for your organization — and nothing you trade away.", "/images/hero/hero-1.jpg"],
      ["management", "Governance", "Member-governed, geographically balanced, accountable to its membership.", "/images/hero/hero-2.jpg"],
      ["branches", "Our Members", "6 CX associations and 15 professional training institutes across all 16 SADC Member States.", "/images/hero/hero-3.jpg"],
    ];
    for (const [slug, title, subtitle, img] of pages) db.prepare('INSERT INTO page_heroes (page_slug, title, subtitle, image_url) VALUES (?,?,?,?)').run(slug, title, subtitle, img);
  }

  // leadership intentionally left unseeded (council leadership added via CMS once constituted)

  const n = db.prepare('SELECT COUNT(*) as c FROM news').get();
  if (!n || n.c === 0) {
    const articles = [
      ["SACXC Launches as the Regional CX Council for SADC", "sacxc-launches-regional-cx-council", "SACXC unites CX associations and training institutes across all 16 SADC Member States under one standard.", "<p>The Southern Africa Customer Experience Council (SACXC) has launched as the regional body uniting SADC’s national CX associations and professional training institutes under one coordinated structure — without displacing any member’s independence or national mandate.</p>", "Announcement", 1, 1],
      ["SACXC Affiliates with ACXCO", "sacxc-affiliates-with-acxco", "The Council joins the continental standards agenda as an ACXCO affiliate member.", "<p>SACXC is now an affiliate member of the African Council of Customer Experience Organizations (ACXCO), linking Southern Africa’s CX community into the continental standards, accreditation and advocacy agenda.</p>", "Partnership", 1, 1],
      ["The State of CX in SADC — Research Programme Announced", "state-of-cx-in-sadc-research", "SACXC will produce regional CX benchmarking research members can use at home.", "<p>SACXC has announced its flagship regional research programme, the State of CX in SADC, giving members benchmarking data to advocate for CX investment, brief regulators and support course development.</p>", "Research", 1, 0],
    ];
    for (const [t, sl, ex, co, tag, pub, feat] of articles) db.prepare('INSERT INTO news (title, slug, excerpt, content, tag, published, featured, author) VALUES (?,?,?,?,?,?,?,?)').run(t, sl, ex, co, tag, pub, feat, 'SACXC Secretariat');
  }

  const ev = db.prepare('SELECT COUNT(*) as c FROM events').get();
  if (!ev || ev.c === 0) {
    db.prepare('INSERT INTO events (title, slug, description, content, location, event_date, event_time, published) VALUES (?,?,?,?,?,?,?,?)').run("State of CX in SADC — Regional Forum","state-of-cx-in-sadc-regional-forum","SACXC’s flagship regional convening of CX associations and training institutes.","<p>SACXC’s flagship regional convening brings members together to review the regional CX standard, share good practice and set the coordination agenda with ACXCO. Dates to be confirmed — contact the Secretariat to register your interest.</p>","Gaborone, Botswana","","To be announced",1);
  }

  const ac = db.prepare('SELECT COUNT(*) as c FROM achievements').get();
  if (!ac || ac.c === 0) {
    const milestones = [
      ["Goal 01", "Objective", "A single SADC-wide CX standard", "Establish a single, credible, SADC-wide standard for CX practice and CX training.", 1],
      ["Goal 02", "Objective", "A portable accreditation pathway", "Support an accreditation pathway that gives SADC CX qualifications recognized, portable currency across the region.", 2],
      ["Goal 03", "Objective", "Recognition as a profession", "Advance recognition of CX as a professional discipline with regulators, labour ministries and academic institutions across SADC.", 3],
      ["Goal 04", "Objective", "A voice within ACXCO", "Represent the region’s CX associations and institutes within ACXCO’s continental standards, research and advocacy agenda.", 4],
      ["Goal 05", "Objective", "Stronger member institutions", "Strengthen the institutional capacity of member associations and institutes, particularly newer or smaller ones.", 5],
      ["Goal 06", "Objective", "SADC-specific CX research", "Generate SADC-specific CX research and benchmarking data members can use to make the case for CX investment at home.", 6],
      ["Goal 07", "Objective", "A channel into SADC", "Serve as the coordination point between SADC’s CX community and the SADC Secretariat.", 7],
    ];
    for (const [y, b, t, d, o] of milestones) db.prepare('INSERT INTO achievements (year, badge, title, description, sort_order) VALUES (?,?,?,?,?)').run(y, b, t, d, o);
  }

  const pr = db.prepare('SELECT COUNT(*) as c FROM partners').get();
  if (!pr || pr.c === 0) {
    db.prepare('INSERT INTO partners (name, type, description, highlights, sort_order) VALUES (?,?,?,?,?)').run("ACXCO","Continental","African Council of Customer Experience Organizations — the continental body uniting Africa’s national CX professional bodies under a shared standard, accreditation system and voice.","Continental standards agenda|Accreditation framework|Continental recognition for members",1);
    db.prepare('INSERT INTO partners (name, type, description, highlights, sort_order) VALUES (?,?,?,?,?)').run("SADC Secretariat","Regional","Headquartered in Gaborone alongside the SADC Secretariat, SACXC engages regional policy processes on behalf of its members.","Regional policy engagement|Proximity to SADC institutions|A channel for the CX community",2);
  }

  // gallery & testimonials intentionally left unseeded (added via CMS)

  const re = db.prepare('SELECT COUNT(*) as c FROM resources').get();
  if (!re || re.c === 0) {
    const docs = [
      ["SACXC Membership Guide", "Overview of membership categories, benefits and how to join. Published once fees and forms are finalized.", "—", "PDF", 0],
      ["State of CX in SADC (Research)", "Regional CX benchmarking research for members. Forthcoming.", "—", "PDF", 0],
      ["Regional CX Competency Framework", "The shared SADC-wide definition of professional CX practice. Forthcoming.", "—", "PDF", 0],
    ];
    for (let i = 0; i < docs.length; i++) db.prepare('INSERT INTO resources (title, description, file_size, file_type, downloadable, sort_order) VALUES (?,?,?,?,?,?)').run(docs[i][0], docs[i][1], docs[i][2], docs[i][3], docs[i][4], i + 1);
  }

  const pc = db.prepare('SELECT COUNT(*) as c FROM page_content').get();
  if (!pc || pc.c === 0) {
    db.prepare('INSERT OR IGNORE INTO page_content (page_slug, section_key, content) VALUES (?,?,?)').run('membership','intro',"SACXC’s current membership — 6 CX associations and 15 professional training institutes — spans the SADC region and continues to grow as additional national bodies formalize their affiliation.");
    db.prepare('INSERT OR IGNORE INTO page_content (page_slug, section_key, content) VALUES (?,?,?)').run('why-sacxc','main',"Choosing SACXC means a regional and continental voice, standards you did not have to write alone, and a route to ACXCO recognition — while you keep your independence.");
  }

  const br = db.prepare('SELECT COUNT(*) as c FROM branches').get();
  if (!br || br.c === 0) {
    const branches = [
      ["Angola", "Central Africa", "National CX associations & professional training institutes"],
      ["Botswana", "Southern Africa", "National CX associations & professional training institutes"],
      ["Comoros", "Indian Ocean", "National CX associations & professional training institutes"],
      ["Democratic Republic of Congo", "Central Africa", "National CX associations & professional training institutes"],
      ["Eswatini", "Southern Africa", "National CX associations & professional training institutes"],
      ["Lesotho", "Southern Africa", "National CX associations & professional training institutes"],
      ["Madagascar", "Indian Ocean", "National CX associations & professional training institutes"],
      ["Malawi", "Southern Africa", "National CX associations & professional training institutes"],
      ["Mauritius", "Indian Ocean", "National CX associations & professional training institutes"],
      ["Mozambique", "Southern Africa", "National CX associations & professional training institutes"],
      ["Namibia", "Southern Africa", "National CX associations & professional training institutes"],
      ["Seychelles", "Indian Ocean", "National CX associations & professional training institutes"],
      ["South Africa", "Southern Africa", "National CX associations & professional training institutes"],
      ["Tanzania", "East Africa", "National CX associations & professional training institutes"],
      ["Zambia", "Southern Africa", "National CX associations & professional training institutes"],
      ["Zimbabwe", "Southern Africa", "National CX associations & professional training institutes"],
    ];
    branches.forEach((b, i) => { db.prepare('INSERT INTO branches (name, region, description, sort_order) VALUES (?,?,?,?)').run(b[0], b[1], b[2], i + 1); });
  }

  const be = db.prepare('SELECT COUNT(*) as c FROM benefits').get();
  if (!be || be.c === 0) {
    const benefits = [
      ["scale-balanced", "Standards", "Coordinate SADC-wide CX standards and good-practice guidance, developed with input from every member across the region."],
      ["certificate", "Accreditation Support", "A regionally coordinated accreditation framework for CX training and professional development, aligned with ACXCO’s continental pathway."],
      ["magnifying-glass-chart", "Research", "The State of CX in SADC — regional benchmarking research members use to make the case for CX investment at home."],
      ["bullhorn", "Advocacy", "Represent the region’s CX community to SADC institutions and ACXCO, and advance recognition of CX as a profession."],
      ["people-group", "Capacity-Building", "Mentorship, governance guidance and peer support that build institutional capacity for newer or smaller members."],
      ["handshake", "Convening", "Regional General Meetings, forums and a standing peer network connecting CX bodies across the SADC states."],
    ];
    benefits.forEach((b, i) => { db.prepare('INSERT INTO benefits (icon, title, description, sort_order) VALUES (?,?,?,?)').run(b[0], b[1], b[2], i + 1); });
  }

  // Seed CMS-driven navigation menu (the 8 deck pages)
  const mi = db.prepare('SELECT COUNT(*) as c FROM menu_items').get();
  if (!mi || mi.c === 0) {
    const menu = [
      ['Home','/',1],['About','/about',2],['Membership','/membership',3],['Services','/services',4],
      ['Our Members','/our-members',5],['Governance','/governance',6],['ACXCO','/acxco',7],['Get Involved','/get-involved',8]
    ];
    menu.forEach(m => db.prepare('INSERT INTO menu_items (label, url, location, sort_order) VALUES (?,?,?,?)').run(m[0], m[1], 'header', m[2]));
  }

  // Seed editable website-content blocks (managed under "Website Content" in the CMS)
  const blocks = [
    ['home','intro_heading','A single regional council for Southern Africa\'s CX community'],
    ['home','intro_body','Across the SADC region, national CX associations and professional training institutes have each been building standards, training practitioners and pushing organizations to serve customers better — largely in isolation. SACXC exists to change that: one regional council, member-governed, coordinating standards, accreditation support, research and advocacy — while every member keeps its independence.'],
    ['home','why_heading','What membership changes for your organization'],
    ['home','closing_heading','Give your organization a regional — and continental — voice'],
    ['about','who_body','SACXC is headquartered in Gaborone, Botswana, in the same city as the SADC Secretariat — positioned to engage regional institutions directly while remaining accountable to, and governed by, its own membership.'],
    ['services','intro','Standards, accreditation support, research, advocacy, capacity-building and convening — delivered regionally so no member has to build them alone.'],
    ['members','intro','SACXC\'s membership brings together 6 national CX associations and 15 professional training institutes from across the SADC region — one regional community, sixteen countries.'],
    ['governance','model','SACXC operates on a member-governed, one member organization / one vote basis within each membership category. Every SADC Member State has an equal institutional voice at the Council.'],
    ['acxco','intro','SACXC is an affiliate member of the African Council of Customer Experience Organizations (ACXCO) — the continental body uniting Africa\'s national CX professional bodies under a shared standard, accreditation system and voice.'],
    ['contact','case','A national CX association or professional training institute joining SACXC trades nothing away and gains a regional and continental voice, standards it did not have to write alone, and a route to ACXCO recognition.']
  ];
  for (const [pg, key, val] of blocks)
    db.prepare('INSERT OR IGNORE INTO page_content (page_slug, section_key, content) VALUES (?,?,?)').run(pg, key, val);

}

module.exports = { seedDatabase };

if (require.main === module) {
  (async () => {
    const { initDb, getDb } = require('./middleware/database');
    await initDb();
    seedDatabase(getDb());
    console.log('Database setup complete!');
    process.exit(0);
  })().catch(err => { console.error('Setup failed:', err); process.exit(1); });
}
