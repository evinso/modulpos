const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: 'Bu kayıt zaten mevcut',
      field: err.meta?.target
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      error: 'Kayıt bulunamadı'
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validasyon hatası',
      details: err.details
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Geçersiz token' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token süresi dolmuş' });
  }

  // Default
  res.status(err.status || 500).json({
    error: err.message || 'Sunucu hatası'
  });
};

module.exports = { errorHandler };
