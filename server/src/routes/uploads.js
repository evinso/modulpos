const express = require('express');
const prisma = require('../config/database');

/**
 * PUBLIC pictures (no login): the marketplace downloads the pictures of a product from here. The address carries a random id
 * (122 bits), nothing is listed. Pictures are deleted again once the marketplace has them (services/hostedImages.js).
 */
const router = express.Router();

router.get('/:file', async (req, res, next) => {
  try {
    const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/i.exec(req.params.file);
    if (!m) return res.status(404).end();
    const row = await prisma.productImageUpload.findUnique({ where: { id: m[1].toLowerCase() }, select: { mime: true, ext: true, data: true } });
    if (!row || row.ext !== m[2].toLowerCase()) return res.status(404).end();
    res.set({
      'Content-Type': row.mime,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Disposition': 'inline',
    });
    res.send(Buffer.from(row.data));
  } catch (err) { next(err); }
});

module.exports = router;
