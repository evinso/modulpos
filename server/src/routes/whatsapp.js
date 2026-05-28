const express = require('express');
const prisma = require('../config/database');
const { auth } = require('../middleware/auth');
const WahaService = require('../services/whatsapp/wahaService');

const router = express.Router();
router.use(auth);
router.use((req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  }
  next();
});

async function getUserStore(userId) {
  return prisma.store.findFirst({ where: { userId } });
}

async function getConn(id, storeId) {
  const conn = await prisma.whatsappConnection.findFirst({ where: { id, storeId } });
  if (!conn) throw Object.assign(new Error('Bağlantı bulunamadı'), { status: 404 });
  return conn;
}

// List connections
router.get('/connections', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const list = await prisma.whatsappConnection.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(list);
  } catch (err) { next(err); }
});

// Create connection
router.post('/connections', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const { name, instanceId } = req.body;
    if (!name || !instanceId) return res.status(400).json({ error: 'Ad ve Oturum Adı zorunludur' });
    const conn = await prisma.whatsappConnection.create({
      data: { storeId: store.id, name, instanceId: instanceId.trim(), apiToken: 'waha' },
    });
    res.json(conn);
  } catch (err) { next(err); }
});

// Update connection
router.put('/connections/:id', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    await getConn(req.params.id, store.id);
    const { name, instanceId } = req.body;
    const conn = await prisma.whatsappConnection.update({
      where: { id: req.params.id },
      data: { name, instanceId: instanceId?.trim() },
    });
    res.json(conn);
  } catch (err) { next(err); }
});

// Delete connection
router.delete('/connections/:id', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    await getConn(req.params.id, store.id);
    await prisma.whatsappConnection.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Get status
router.get('/connections/:id/status', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conn = await getConn(req.params.id, store.id);
    const svc = new WahaService(conn.instanceId);
    const data = await svc.getStatus();
    res.json(data);
  } catch (err) { next(err); }
});

// Get QR code
router.get('/connections/:id/qr', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conn = await getConn(req.params.id, store.id);
    const svc = new WahaService(conn.instanceId);
    const data = await svc.getQR();
    res.json(data);
  } catch (err) { next(err); }
});

// Send test message
router.post('/connections/:id/send', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conn = await getConn(req.params.id, store.id);
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Telefon ve mesaj zorunludur' });
    const svc = new WahaService(conn.instanceId);
    const data = await svc.sendMessage(phone, message);
    res.json(data);
  } catch (err) { next(err); }
});

// Logout
router.post('/connections/:id/logout', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conn = await getConn(req.params.id, store.id);
    const svc = new WahaService(conn.instanceId);
    const data = await svc.logout();
    res.json(data);
  } catch (err) { next(err); }
});

// Reboot
router.post('/connections/:id/reboot', async (req, res, next) => {
  try {
    const store = await getUserStore(req.user.id);
    if (!store) return res.status(404).json({ error: 'Mağaza bulunamadı' });
    const conn = await getConn(req.params.id, store.id);
    const svc = new WahaService(conn.instanceId);
    const data = await svc.reboot();
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
