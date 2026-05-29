const prisma = require('../config/database');
const sseService = require('./sseService');
const whatsappService = require('./whatsappService');

class NotificationService {
  async create({ storeId, title, message, type = 'info', link = null, data = null, noWhatsapp = false }) {
    try {
      const notification = await prisma.notification.create({
        data: { storeId, title, message, type, link, data },
      });
      sseService.pushToStore(storeId, notification);

      if (!noWhatsapp) {
        prisma.store.findUnique({ where: { id: storeId }, select: { user: { select: { phone: true } } } })
          .then(store => whatsappService.forwardInAppNotification(store?.user?.phone, title, message))
          .catch(() => {});
      }

      return notification;
    } catch (error) {
      console.error('Notification creation failed:', error);
      return null;
    }
  }

  async getForStore(storeId, { limit = 20, unreadOnly = false } = {}) {
    try {
      const where = { storeId };
      if (unreadOnly) where.isRead = false;
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

  async markAsRead(id) {
    try {
      return await prisma.notification.update({ where: { id }, data: { isRead: true } });
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      return null;
    }
  }

  async createForUser(userId, { title, message, type = 'info', link = null, data = null, noWhatsapp = false }) {
    try {
      const store = await prisma.store.findFirst({ where: { userId } });
      if (!store) return null;
      return await this.create({ storeId: store.id, title, message, type, link, data, noWhatsapp });
    } catch (error) {
      console.error('Notification createForUser failed:', error);
      return null;
    }
  }

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
