require('dotenv').config();

/**
 * ModulPOS API Server
 * Version: 1.0.1
 */
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

const { errorHandler } = require('./middleware/errorHandler');

const app = express();

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

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [...defaultDevOrigins, ...productionOrigins];

// Security
app.use(helmet());
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 300 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.originalUrl.includes('/payment/paytr-callback'),
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

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
    const adminEmail = 'ozgurklc111@gmail.com';
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

// Auto-create PaytrLog table if migration hasn't been run on production DB
const ensurePaytrLogTable = async () => {
  try {
    const prisma = require('./config/database');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PaytrLog" (
        "id" TEXT NOT NULL,
        "merchantOid" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "totalAmount" DOUBLE PRECISION NOT NULL,
        "userId" TEXT,
        "userEmail" TEXT,
        "type" TEXT,
        "failReason" TEXT,
        "rawBody" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PaytrLog_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PaytrLog_status_idx" ON "PaytrLog"("status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "PaytrLog_createdAt_idx" ON "PaytrLog"("createdAt")`);
    console.log('✅ PaytrLog table ensured.');
  } catch (err) {
    console.error('⚠️  PaytrLog table ensure error:', err.message);
  }
};
ensurePaytrLogTable();

// Add yearlyPrice column to LandingPricingPlan if not exists
(async () => {
  try {
    const prisma = require('./config/database');
    await prisma.$executeRawUnsafe(`ALTER TABLE "LandingPricingPlan" ADD COLUMN IF NOT EXISTS "yearlyPrice" TEXT`);
  } catch (e) {
    console.error('yearlyPrice column ensure error:', e.message);
  }
})();

const cronService = require('./services/cronService');
cronService.start();

const PORT = process.env.PORT || 3001;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;
