/**
 * Sends a long list to the marketplace in batches instead of one huge request.
 * After every accepted batch `record(start, part, response)` is called, so the progress is kept even when a later
 * batch fails (the rest is simply tried again on the next run). Never throws: returns { sent, failed, error }.
 */
async function pushInBatches(items, send, record, size = 500) {
  let sent = 0;
  for (let i = 0; i < items.length; i += size) {
    const part = items.slice(i, i + size);
    try {
      const res = await send(part);
      await record(i, part, res);
      sent += part.length;
    } catch (error) {
      return { sent, failed: items.length - sent, error };
    }
  }
  return { sent, failed: 0, error: null };
}

module.exports = { pushInBatches };
