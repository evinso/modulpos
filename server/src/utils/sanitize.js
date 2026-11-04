/** Removes marketplace credentials from a connection before sending it to the browser. */
function publicConnection(conn) {
  if (!conn) return conn;
  const { apiKey, apiSecret, ...rest } = conn;
  return { ...rest, apiKeyHint: apiKey ? `****${String(apiKey).slice(-4)}` : null };
}

module.exports = { publicConnection };
