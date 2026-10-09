const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

// Route Imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const roomRoutes = require('./routes/roomRoutes');
const guestRoutes = require('./routes/guestRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const folioRoutes = require('./routes/folioRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const depositRoutes = require('./routes/depositRoutes');
const nightAuditRoutes = require('./routes/nightAuditRoutes');
const reportRoutes = require('./routes/reportRoutes');
const auditLogRoutes = require('./routes/auditLogRoutes');

// Frontend-facing routes (browser-data store, sessions, public pages, AI, OCR, super admin)
const sessionRoutes = require('./routes/sessionRoutes');
const storeRoutes = require('./routes/storeRoutes');
const publicRoutes = require('./routes/publicRoutes');
const aiRoutes = require('./routes/aiRoutes');
const ocrRoutes = require('./routes/ocrRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const notifyRoutes = require('./routes/notifyRoutes');
const miscTransactionRoutes = require('./routes/miscTransactionRoutes');

const app = express();

// Middleware
const defaultAllowedOrigins = [
  'http://app.ahaalo.com',
  'https://app.ahaalo.com',
  'http://admin.ahaalo.com',
  'https://admin.ahaalo.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

const envOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...envOrigins]));

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1') ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Hotel-Id'],
  })
);
// Large limit: hotel logo / gallery images and the full bookings list are saved as one value
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health Check Route
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'PMS Backend API is running cleanly', time: new Date() });
});

// Mount API Routes
app.use('/api/session', sessionRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/superadmin', superAdminRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/misc-transactions', miscTransactionRoutes);

// Old single-hotel REST API (not used by the app, not hotel-aware). Off by default so hotels can never see each other's data.
if (String(process.env.ENABLE_LEGACY_API).toLowerCase() === 'true') {
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/property', propertyRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/guests', guestRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/folios', folioRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/deposits', depositRoutes);
  app.use('/api/night-audit', nightAuditRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/audit-logs', auditLogRoutes);
}

// Central Error Handler
app.use(errorHandler);

module.exports = app;