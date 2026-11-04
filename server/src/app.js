require('dotenv').config();

/**
 * ModulPOS API Server
 * Version: 1.0.1
 */
const net = require('net');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const dashboardRoutes = require('./routes/dashboard');
const productRoutes = require('./routes/products');
const xmlSourceRoutes = require('./routes/xmlSources');
const marketplaceRoutes = require('./routes/marketplace');
const orderRoutes = require('./routes/orders');
const pricingRoutes = require('./routes/pricing');
const questionRoutes = require('./routes/questions');
const xmlConverterRoutes = require('./routes/xmlConverter');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const globalXmlRoutes = require('./routes/globalXml');
const creditRoutes = require('./routes/credits');
const paymentRoutes = require('./routes/payment');
const dropshipOrderRoutes = require('./routes/dropshipOrders');
const supportRoutes = require('./routes/support');
const aiRoutes = require('./routes/ai');
const whatsappRoutes = require('./routes/whatsapp');
const webhookRoutes = require('./routes/webhooks');

const { errorHandler } = require('./middleware/errorHandler');

// Fail fast on a missing/placeholder signing secret in production
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || secret === 'change-me-in-production') {
    console.error('FATAL: JWT_SECRET is missing, too short (<32) or still the placeholder.');
    process.exit(1);
  }
}

const app = express();

// Behind Render's load balancer: use the real client IP (rate limiting, logs)
app.set('trust proxy', 1);

// Render sits behind Cloudflare plus internal proxies, so req.ip would be an internal
// 10.x address shared by every visitor. Cloudflare always sets cf-connecting-ip to the
// real client (and overwrites any client-supplied value), so use it when present.
app.use((req, _res, next) => {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && net.isIP(cf.trim())) {
    Object.defineProperty(req, 'ip', { value: cf.trim(), configurable: true });
  }
  next();
});

const defaultDevOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176'
];

const productionOrigins = [
  'https://modulpos.com',
  'https://www.modulpos.com'
];

const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

// Always include production origins regardless of env var
const allowedOrigins = [...new Set([...envOrigins, ...productionOrigins, ...defaultDevOrigins])];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    const corsErr = new Error('CORS: origin not allowed');
    corsErr.status = 403;
    callback(corsErr);
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

// CORS must come before helmet so preflight OPTIONS gets correct headers
app.use(cors(corsOptions));

// Security
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 300 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  // req.path (not the URL with query string) so the exemption cannot be spoofed
  skip: (req) => req.path === '/payment/paytr-callback',
});
app.use('/api/', limiter);

// Stricter limit for credential endpoints (brute force / OTP guessing)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla deneme. Lütfen 15 dakika sonra tekrar deneyin.' },
});
app.use(['/api/auth/login', '/api/auth/register', '/api/auth/verify-otp'], authLimiter);

// Body parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Logging
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Routes
app.use('/api/public', publicRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/products', productRoutes);
app.use('/api/xml-sources', xmlSourceRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/xml-converter', xmlConverterRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/global-xml', globalXmlRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/dropship-orders', dropshipOrderRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/webhooks', webhookRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

// Bootstrap Admin User
const bootstrapAdmin = async () => {
  try {
    const prisma = require('./config/database');
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (!adminEmail) return;
    const user = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (user && user.role !== 'superadmin') {
      await prisma.user.update({
        where: { email: adminEmail },
        data: { 
          role: 'superadmin',
          isActive: true
        }
      });
      console.log(`🚀 Admin bootstrap: ${adminEmail} promoted to superadmin.`);
    }
  } catch (err) {
    console.error('❌ Admin bootstrap error:', err.message);
  }
};
bootstrapAdmin();

const cronService = require('./services/cronService');
cronService.start();

const PORT = process.env.PORT || 3001;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;
