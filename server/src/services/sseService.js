// Map<storeId, Set<res>> — active SSE connections
const clients = new Map();

function addClient(storeId, res) {
  if (!clients.has(storeId)) clients.set(storeId, new Set());
  clients.get(storeId).add(res);
}

function removeClient(storeId, res) {
  const set = clients.get(storeId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(storeId);
}

function pushToStore(storeId, notification) {
  const set = clients.get(storeId);
  if (!set || set.size === 0) return;
  const data = `data: ${JSON.stringify(notification)}\n\n`;
  for (const res of set) {
    try { res.write(data); } catch {}
  }
}

module.exports = { addClient, removeClient, pushToStore };
