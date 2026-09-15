/**
 * Database middleware — node-sqlite3-wasm (pure WebAssembly, synchronous, durable).
 *
 * Why WASM instead of native better-sqlite3:
 *   better-sqlite3 is a native addon. On shared hosts like Hostinger the build
 *   fails for two reasons seen in the deploy logs:
 *     1. The prebuilt binary needs a newer GLIBC than the server has
 *        (`GLIBC_2.29 not found`), so npm falls back to compiling from source.
 *     2. Source compilation then fails because build tools are missing
 *        (`node-gyp ... Error: not found: make`).
 *   node-sqlite3-wasm ships a portable .wasm build of SQLite — there is NOTHING
 *   to compile and NO GLIBC dependency, so `npm install` always succeeds on any
 *   host and any Node version (18/20/22). The API is synchronous and close
 *   enough to better-sqlite3 that the wrapper below keeps the rest of the app
 *   unchanged.
 *
 * Durability:
 *   node-sqlite3-wasm persists to the real SQLite file on disk. Every
 *   INSERT/UPDATE/DELETE is committed to that file synchronously, so data
 *   survives the aggressive/ungraceful restarts Passenger performs. We also
 *   register exit handlers that close the handle so the OS flushes cleanly.
 *
 * The public API (initDb, getDb, saveDb, getRawDb) is unchanged so the rest of
 * the app keeps working without any further edits.
 */
const { Database } = require('node-sqlite3-wasm');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'sacxc.db');
let db = null;

// Make sure the data directory exists (fresh Hostinger deployments often
// don't have it). Parents are created recursively.
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

/**
 * Clear a STALE lock left by an ungraceful shutdown.
 *
 * node-sqlite3-wasm guards writes with a directory-based lock ("<db>.lock").
 * If the process is killed hard — which Passenger does routinely — that lock
 * directory can be left behind, and the NEXT boot then fails with
 * "database is locked" and the whole app refuses to start. Under Passenger
 * only one app process runs at a time, so any lock present at startup is by
 * definition stale and safe to remove. We clear it before opening the DB.
 */
function clearStaleLock() {
  const candidates = [dbPath + '.lock', dbPath + '-journal', dbPath + '.lock.lock'];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const st = fs.statSync(p);
        if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
        else fs.unlinkSync(p);
      }
    } catch (e) { /* best-effort */ }
  }
}
clearStaleLock();

/**
 * saveDb() is a no-op — node-sqlite3-wasm writes straight to the on-disk
 * database file, so there is nothing to flush manually. We keep the export so
 * legacy callers (setup-db.js and older code) don't break.
 */
function saveDb() { /* intentional no-op — writes are already durable */ }

/**
 * initDb — opens (or creates) the SQLite file on disk, applies pragmas,
 * runs idempotent migrations, and seeds the developer account on first boot.
 * Returns a Promise for API compatibility with the original sql.js version
 * (server.js does `initDb().then(...)`).
 */
async function initDb() {
  db = new Database(dbPath);

  // Pragmas for durability + speed on shared hosts. node-sqlite3-wasm accepts
  // PRAGMA through exec(). foreign_keys ON enforces referential rules; a large
  // page cache and in-memory temp store cut disk I/O under load.
  try {
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA cache_size = -16000');
    db.exec('PRAGMA temp_store = MEMORY');
  } catch (e) { /* pragmas are best-effort */ }

  // ---------- Auto-seed on first boot ----------
  let needsSeed = false;
  try {
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!tbl) needsSeed = true;
  } catch (e) { needsSeed = true; }

  if (needsSeed) {
    console.log('[db] Fresh database detected — seeding schema and initial data...');
    try {
      const { seedDatabase } = require('../setup-db');
      seedDatabase(getDb());
      console.log('[db] Seed complete — schema, settings, branches, hero, benefits etc. all created.');
    } catch (e) {
      console.error('[db] Auto-seed failed:', e.message);
    }
  }

  // ---------- Idempotent migrations for already-seeded installs ----------

  // leadership.linkedin — added for team cards.
  try {
    const cols = db.prepare('PRAGMA table_info(leadership)').all().map(r => r.name);
    if (cols.length && !cols.includes('linkedin')) {
      db.exec('ALTER TABLE leadership ADD COLUMN linkedin TEXT');
    }
  } catch (e) { /* table may not exist yet */ }

  // must_change_password column for older databases (idempotent).
  try { db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0"); } catch (e) { /* exists */ }

  // Ensure CMS navigation menu exists (idempotent migration for upgrades).
  try {
    db.exec("CREATE TABLE IF NOT EXISTS menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, url TEXT NOT NULL, location TEXT DEFAULT 'header', sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    const c = db.prepare('SELECT COUNT(*) c FROM menu_items').get();
    if (!c || c.c === 0) {
      const menu = [['Home','/',1],['About','/about',2],['Membership','/membership',3],['Services','/services',4],['Our Members','/our-members',5],['Governance','/governance',6],['ACXCO','/acxco',7],['Get Involved','/get-involved',8]];
      menu.forEach(m => db.prepare("INSERT INTO menu_items (label,url,location,sort_order) VALUES (?,?, 'header', ?)").run([m[0], m[1], m[2]]));
    }
  } catch (e) { /* tolerate */ }

  // Normalise the Workplace Protection icon to a valid FA6 name.
  try {
    db.prepare("UPDATE benefits SET icon = 'shield-halved' WHERE title = 'Workplace Protection' AND icon = 'shield-check'").run();
  } catch (e) { /* benefits table may not exist yet */ }

  // Helpful indexes for the hot read paths (idempotent). Big wins under load.
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_news_published ON news(published, created_at)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_events_published ON events(published, event_date)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_menu_items_loc ON menu_items(location, active, sort_order)");
  } catch (e) { /* tables may not exist yet on very first boot */ }

  return db;
}

/**
 * getDb() returns an object whose prepare/exec/pragma signatures match what the
 * rest of the app already calls — .get(...args), .all(...args), .run(...args).
 *
 * IMPORTANT node-sqlite3-wasm difference:
 *   its prepared statements take bound parameters as a SINGLE array argument,
 *   i.e. stmt.run([a, b, c]) — not stmt.run(a, b, c). The wrapper normalises
 *   the variadic call style used throughout this codebase into that array form,
 *   so callers keep working untouched. It also handles the case where a caller
 *   already passes a single array.
 */
function normalizeParams(params) {
  if (params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run(...params) {
          const info = stmt.run(normalizeParams(params));
          return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
        },
        get(...params) { return stmt.get(normalizeParams(params)); },
        all(...params) { return stmt.all(normalizeParams(params)); },
      };
    },
    exec(sql) { db.exec(sql); },
    // Compatibility shim: some code called db.pragma('foo = bar'); route it
    // through exec()/prepare so both PRAGMA-set and PRAGMA-read forms work.
    pragma(expr) {
      const asQuery = 'PRAGMA ' + expr;
      try { return db.prepare(asQuery).all(); }
      catch (e) { db.exec(asQuery); return []; }
    },
  };
}

/** Raw underlying node-sqlite3-wasm Database (used by the session store). */
function getRawDb() { if (!db) throw new Error('Database not initialized'); return db; }

// Graceful shutdown — close the DB handle so the file flushes cleanly.
function closeDb() {
  if (db) { try { db.close(); } catch (e) { /* ignore */ } db = null; }
}
process.on('exit', closeDb);
process.on('SIGINT',  () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

module.exports = { getRawDb, initDb, getDb, saveDb };
