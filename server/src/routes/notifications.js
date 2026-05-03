const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const { auth } = require('../middleware/auth');

/**
 * GET /api/notifications
 * Get all notifications for the current store
 */
router.get('/', auth, async (req, res) => {
  try {
    const notifications = await notificationService.getForStore(req.user.storeId, {
      limit: parseInt(req.query.limit) || 20,
      unreadOnly: req.query.unreadOnly === 'true'
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark a notification as read
 */
router.post('/:id/read', auth, async (req, res) => {
  try {
    const notification = await notificationService.markAsRead(req.params.id);
    res.json(notification);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 */
router.post('/read-all', auth, async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user.storeId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
