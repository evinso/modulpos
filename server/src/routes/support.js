const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /support — list my tickets
router.get('/', auth, async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = { userId: req.user.id };
    if (status) where.status = status;

    const tickets = await prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 1 },
        _count: { select: { messages: true } }
      }
    });

    res.json(tickets);
  } catch (error) {
    next(error);
  }
});

// POST /support — create ticket
router.post('/', auth, async (req, res, next) => {
  try {
    const { subject, category, priority, message } = req.body;
    if (!subject?.trim()) return res.status(400).json({ error: 'Konu zorunludur' });
    if (!message?.trim()) return res.status(400).json({ error: 'Mesaj zorunludur' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const senderName = user?.name || user?.email || 'Kullanıcı';

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.user.id,
        subject: subject.trim(),
        category: category || 'general',
        priority: priority || 'normal',
        messages: {
          create: {
            isAdmin: false,
            senderName,
            message: message.trim()
          }
        }
      },
      include: { messages: true }
    });

    res.status(201).json(ticket);
  } catch (error) {
    next(error);
  }
});

// GET /support/:id — get ticket with all messages
router.get('/:id', auth, async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
    if (!ticket) return res.status(404).json({ error: 'Bilet bulunamadı' });
    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

// POST /support/:id/reply — customer reply
router.post('/:id/reply', auth, async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mesaj zorunludur' });

    const ticket = await prisma.supportTicket.findFirst({
      where: { id: req.params.id, userId: req.user.id }
    });
    if (!ticket) return res.status(404).json({ error: 'Bilet bulunamadı' });
    if (ticket.status === 'closed') return res.status(400).json({ error: 'Kapalı bilete yanıt verilemez' });

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const senderName = user?.name || user?.email || 'Kullanıcı';

    const [msg] = await prisma.$transaction([
      prisma.supportMessage.create({
        data: {
          ticketId: ticket.id,
          isAdmin: false,
          senderName,
          message: message.trim()
        }
      }),
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: ticket.status === 'resolved' ? 'open' : ticket.status, updatedAt: new Date() }
      })
    ]);

    res.status(201).json(msg);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
