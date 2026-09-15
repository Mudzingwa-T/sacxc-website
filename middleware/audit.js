/**
 * Audit log writer + email notification stub.
 *
 * SACXC Turn B — logs every sensitive admin action and optionally
 * fires an email to the developer account (info@codelabsalliance.com)
 * when non-developer admins perform destructive/sensitive operations.
 *
 * Email delivery is configured via SMTP env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 * If SMTP is not configured, emails are logged to console instead
 * (safe default for local dev).
 */
const { getDb } = require('./database');
const { SUPER_ADMIN_EMAIL } = require('./auth');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    return transporter;
  } catch (e) {
    console.warn('[mail] nodemailer not configured:', e.message);
    return null;
  }
}

async function sendEmail({ to, subject, text, html }) {
  const t = getTransporter();
  const from = process.env.SMTP_FROM || 'SACXC CMS <no-reply@sacxc.org>';
  if (!t) {
    // Dev fallback — just log
    console.log('\n[email-sim] →', to);
    console.log('  subject:', subject);
    console.log('  body:   ', (text || '').substring(0, 200));
    console.log('');
    return { simulated: true };
  }
  try {
    const info = await t.sendMail({ from, to, subject, text, html });
    return { messageId: info.messageId };
  } catch (e) {
    console.error('[mail] send failed:', e.message);
    return { error: e.message };
  }
}

function logAction(req, { action, entity, entity_id, details }) {
  try {
    const db = getDb();
    const u = req.session && req.session.user || {};
    db.prepare('INSERT INTO audit_log (user_id, user_name, user_role, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?,?)')
      .run(u.id || null, u.name || 'unknown', u.role || 'unknown', action, entity || '', String(entity_id || ''), details || '', req.ip || '');
  } catch (e) {
    // Never let audit failure break the request
    console.error('[audit] log failed:', e.message);
  }
}

// Notify the developer (Code Labs Alliance) about a sensitive action performed
// by any admin who is NOT the developer themselves.
async function notifyDeveloper(req, { action, details }) {
  const u = req.session && req.session.user || {};
  if (u.email === SUPER_ADMIN_EMAIL) return; // developer themselves — no notification needed

  const subject = `[SACXC CMS] Sensitive action: ${action}`;
  const text = [
    'A sensitive action has been performed in the SACXC CMS.',
    '',
    `Action:  ${action}`,
    `By:      ${u.name || 'unknown'} (${u.email || 'no email'})`,
    `Role:    ${u.role || 'unknown'}`,
    `Details: ${details || '—'}`,
    `Time:    ${new Date().toISOString()}`,
    `IP:      ${req.ip || '?'}`,
    '',
    'If you did not authorize this, review the audit log immediately at /sacxc-cms/audit.',
  ].join('\n');

  await sendEmail({ to: SUPER_ADMIN_EMAIL, subject, text });
}

module.exports = { logAction, notifyDeveloper, sendEmail };
