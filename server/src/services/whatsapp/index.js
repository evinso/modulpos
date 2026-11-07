// Which way WhatsApp is reached: the built-in connection (Baileys, no extra server) or a separate WAHA server.
// Everything else (routes, notifications) goes through createClient(), so the choice is made in exactly one place.
const WahaService = require('./wahaService');
const { getEmbedded, describeEmbeddedError } = require('./embeddedService');

/**
 * WHATSAPP_ENGINE=waha|embedded forces one. Otherwise: a configured WAHA_BASE_URL means WAHA (existing set-ups keep working),
 * nothing configured means the built-in connection.
 */
function engineName() {
  const forced = String(process.env.WHATSAPP_ENGINE || '').trim().toLowerCase();
  if (forced === 'waha' || forced === 'embedded') return forced;
  return String(process.env.WAHA_BASE_URL || '').trim() ? 'waha' : 'embedded';
}

/** A client with getStatus / getQR / sendMessage / logout / reboot. The built-in one is a single shared connection (the session name is ignored). */
function createClient(session) {
  return engineName() === 'embedded' ? getEmbedded() : new WahaService(session);
}

/** Readable sentence for a failed call, whichever engine it came from. */
function describeError(err) {
  if (err && err.userMessage) return err.userMessage;
  return engineName() === 'embedded' ? describeEmbeddedError(err) : WahaService.describeError(err);
}

module.exports = { engineName, createClient, describeError, normalizePhone: WahaService.normalizePhone };
