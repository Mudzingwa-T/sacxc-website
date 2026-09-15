/**
 * WasmSqliteStore — an express-session store backed by node-sqlite3-wasm.
 *
 * Why a custom store:
 *   The original code used `better-sqlite3-session-store`, which requires a
 *   native better-sqlite3 client — the exact module that fails to build on
 *   Hostinger. This store speaks to the same pure-WASM SQLite database, so it
 *   has zero native dependencies and installs everywhere.
 *
 * Design goals:
 *   - Durable: sessions live in a real table on disk, so logins survive the
 *     ungraceful Passenger restarts that used to silently log admins out.
 *   - Bounded: expired rows are pruned on an interval AND opportunistically,
 *     so the table can't grow without limit even under heavy traffic.
 *   - Cheap: a single indexed table, prepared statements, synchronous SQLite.
 *
 * express-session calls these methods with node-style callbacks; SQLite here
 * is synchronous, so we invoke the callback immediately (wrapped so a thrown
 * error is passed to the callback rather than crashing the request).
 */
const { Store } = require('express-session');

class WasmSqliteStore extends Store {
  /**
   * @param {object} opts
   * @param {object} opts.db      raw node-sqlite3-wasm Database (from getRawDb())
   * @param {string} [opts.table] table name (default "sessions")
   * @param {number} [opts.pruneIntervalMs] how often to sweep expired rows
   */
  constructor(opts = {}) {
    super();
    if (!opts.db) throw new Error('WasmSqliteStore requires a { db } option');
    this.db = opts.db;
    this.table = opts.table || 'sessions';

    this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.table} (` +
      `sid TEXT PRIMARY KEY, ` +
      `expire INTEGER NOT NULL, ` +
      `data TEXT NOT NULL)`
    );
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${this.table}_expire ON ${this.table}(expire)`);

    // Periodic prune of expired sessions. unref() so it never keeps the
    // process alive on its own.
    const every = opts.pruneIntervalMs || 15 * 60 * 1000;
    this._timer = setInterval(() => { try { this._prune(); } catch (e) {} }, every);
    if (this._timer.unref) this._timer.unref();
  }

  _now() { return Date.now(); }

  _prune() {
    this.db.prepare(`DELETE FROM ${this.table} WHERE expire <= ?`).run([this._now()]);
  }

  _expireFrom(sess) {
    // Prefer the cookie's own expiry; fall back to 24h.
    const maxAge = sess && sess.cookie && sess.cookie.maxAge;
    if (typeof maxAge === 'number') return this._now() + maxAge;
    if (sess && sess.cookie && sess.cookie.expires) {
      return new Date(sess.cookie.expires).getTime();
    }
    return this._now() + 24 * 60 * 60 * 1000;
  }

  get(sid, cb) {
    setImmediate(() => {
      try {
        const row = this.db.prepare(
          `SELECT data, expire FROM ${this.table} WHERE sid = ?`
        ).get([sid]);
        if (!row) return cb(null, null);
        if (row.expire <= this._now()) {
          try { this.db.prepare(`DELETE FROM ${this.table} WHERE sid = ?`).run([sid]); } catch (e) {}
          return cb(null, null);
        }
        let parsed = null;
        try { parsed = JSON.parse(row.data); } catch (e) { return cb(null, null); }
        return cb(null, parsed);
      } catch (e) { return cb(e); }
    });
  }

  set(sid, sess, cb) {
    setImmediate(() => {
      try {
        const expire = this._expireFrom(sess);
        const data = JSON.stringify(sess);
        this.db.prepare(
          `INSERT INTO ${this.table} (sid, expire, data) VALUES (?, ?, ?) ` +
          `ON CONFLICT(sid) DO UPDATE SET expire = excluded.expire, data = excluded.data`
        ).run([sid, expire, data]);
        if (cb) cb(null);
      } catch (e) { if (cb) cb(e); }
    });
  }

  destroy(sid, cb) {
    setImmediate(() => {
      try {
        this.db.prepare(`DELETE FROM ${this.table} WHERE sid = ?`).run([sid]);
        if (cb) cb(null);
      } catch (e) { if (cb) cb(e); }
    });
  }

  touch(sid, sess, cb) {
    setImmediate(() => {
      try {
        const expire = this._expireFrom(sess);
        this.db.prepare(`UPDATE ${this.table} SET expire = ? WHERE sid = ?`).run([expire, sid]);
        if (cb) cb(null);
      } catch (e) { if (cb) cb(e); }
    });
  }

  clear(cb) {
    setImmediate(() => {
      try { this.db.prepare(`DELETE FROM ${this.table}`).run([]); if (cb) cb(null); }
      catch (e) { if (cb) cb(e); }
    });
  }

  length(cb) {
    setImmediate(() => {
      try {
        const r = this.db.prepare(`SELECT COUNT(*) c FROM ${this.table} WHERE expire > ?`).get([this._now()]);
        cb(null, r ? r.c : 0);
      } catch (e) { cb(e); }
    });
  }
}

module.exports = WasmSqliteStore;
