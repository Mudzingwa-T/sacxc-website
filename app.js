/**
 * Passenger/host entry shim.
 *
 * Some Node hosts (including certain Hostinger Passenger configurations) look
 * for an `app.js` as the application entry point. Our real application lives in
 * server.js and exports the Express app; this file simply re-exports it so the
 * app starts correctly regardless of which entry filename the host expects.
 */
module.exports = require('./server.js');
