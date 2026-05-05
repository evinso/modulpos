require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 300 : 100,
  standardHeaders: true,
  legacyHeaders: false,
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
    if (user && user.role !== 'admin' && user.role !== 'superadmin') {
      await prisma.user.update({
        where: { email: adminEmail },
        data: { role: 'admin' }
      });
      console.log(`✅ Admin bootstrap: ${adminEmail} promoted to admin.`);
    }
  } catch (err) {
    console.error('❌ Admin bootstrap error:', err.message);
  }
};
bootstrapAdmin();

const PORT = process.env.PORT || 3001;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;
