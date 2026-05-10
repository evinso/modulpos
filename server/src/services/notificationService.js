const prisma = require('../config/database');

/**
 * Notification Service
 * Handles creating and retrieving system notifications
 */
class NotificationService {
  /**
   * Create a new notification
   * @param {Object} data { storeId, title, message, type, link }
   */
  async create({ storeId, title, message, type = 'info', link = null }) {
    try {
      return await prisma.notification.create({
        data: {
          storeId,
          title,
          message,
          type,
          link,
        },
      });
    } catch (error) {
      console.error('Notification creation failed:', error);
      return null;
    }
  }

  /**
   * Get notifications for a store
   * @param {string} storeId 
   * @param {Object} options { limit, unreadOnly }
   */
  async getForStore(storeId, { limit = 20, unreadOnly = false } = {}) {
    try {
      const where = { storeId };
      if (unreadOnly) {
        where.isRead = false;
      }

      return await prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      return [];
    }
  }

  /**
   * Mark a notification as read
   * @param {string} id 
   */
  async markAsRead(id) {
    try {
      return await prisma.notification.update({
        where: { id },
        data: { isRead: true },
      });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      return null;
    }
  }

  /**
   * Create a notification by userId (looks up storeId automatically)
   * @param {string} userId
   * @param {Object} data { title, message, type, link }
   */
  async createForUser(userId, { title, message, type = 'info', link = null }) {
    try {
      const store = await prisma.store.findFirst({ where: { userId } });
      if (!store) return null;
      return await this.create({ storeId: store.id, title, message, type, link });
    } catch (error) {
      console.error('Notification createForUser failed:', error);
      return null;
    }
  }

  /**
   * Mark all notifications as read for a store
   * @param {string} storeId
   */
  async markAllAsRead(storeId) {
    try {
      return await prisma.notification.updateMany({
        where: { storeId, isRead: false },
        data: { isRead: true },
      });
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      return null;
    }
  }
}

module.exports = new NotificationService();
