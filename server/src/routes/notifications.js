const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const notificationService = require('../services/notificationService');
const sseService = require('../services/sseService');
const { auth } = require('../middleware/auth');

async function getUserStoreId(userId) {
  const store = await prisma.store.findFirst({ where: { userId }, select: { id: true } });
  return store?.id || null;
}

// SSE stream — EventSource cannot send headers, so it authenticates with the session cookie (withCredentials).
// The token used to travel in the query string, which put every JWT into access logs; that is no longer accepted.
router.get('/stream', auth, async (req, res) => {
  const store = await prisma.store.findFirst({ where: { userId: req.user.id }, select: { id: true } });
  if (!store) return res.status(404).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: disable buffering
  res.flushHeaders();

  res.write(': connected\n\n');

  sseService.addClient(store.id, res);

  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseService.removeClient(store.id, res);
  });
});

router.get('/', auth, async (req, res) => {
  try {
    const storeId = await getUserStoreId(req.user.id);
    if (!storeId) return res.json([]);
    const notifications = await notificationService.getForStore(storeId, {
      limit: parseInt(req.query.limit) || 20,
      unreadOnly: req.query.unreadOnly === 'true'
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/read', auth, async (req, res) => {
  try {
    const storeId = await getUserStoreId(req.user.id);
    if (!storeId) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    // Ensure the notification belongs to this store before marking read
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, storeId }
    });
    if (!notification) return res.status(404).json({ error: 'Bildirim bulunamadı' });
    const updated = await notificationService.markAsRead(req.params.id);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/read-all', auth, async (req, res) => {
  try {
    const storeId = await getUserStoreId(req.user.id);
    if (!storeId) return res.json({ success: true });
    await notificationService.markAllAsRead(storeId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
