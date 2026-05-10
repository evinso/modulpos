const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const notificationService = require('../services/notificationService');
const { auth } = require('../middleware/auth');

async function getUserStoreId(userId) {
  const store = await prisma.store.findFirst({ where: { userId }, select: { id: true } });
  return store?.id || null;
}

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
