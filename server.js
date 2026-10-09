
const dotenv = require('dotenv');
dotenv.config();
const app = require('./src/app');
const connectDB = require('./src/config/db.js');
const { bootstrapDefaultTenant } = require('./src/services/tenantBootstrap');
const { migrateAndResync } = require('./src/services/syncStructuredModels');
const { startScheduler, platformConfigured, verifyPlatform } = require('./src/services/emailService');
const PORT = process.env.PORT || 5000;
// Connect Database and Start Server
connectDB().then(async () => {
  try { await bootstrapDefaultTenant(); } catch (e) { console.error('bootstrapDefaultTenant failed:', e.message); }
  try { await migrateAndResync(); } catch (e) { console.error('migrateAndResync failed:', e.message); }
  if (!process.env.ANTHROPIC_API_KEY) console.log('ℹ️');
  startScheduler();
  if (!platformConfigured()) console.log('ℹ️  Email: AWS_SES_* not set in .env - emails are off');
  else verifyPlatform().then((r) => console.log(r.ok ? '✉️  Email: AWS SES login OK' : `❌ Email: AWS SES login FAILED - ${r.error}`));
  if (!process.env.GOOGLE_VISION_API_KEY) console.log('ℹ️  GOOGLE_VISION_API_KEY not set - ID scanner will fall back to other OCR engines');
  app.listen(PORT, () => {
    console.log(`🚀 PMS Backend Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
});

