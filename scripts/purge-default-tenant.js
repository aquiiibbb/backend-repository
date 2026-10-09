const dotenv = require('dotenv');
dotenv.config();
const connectDB = require('../src/config/db');
const Tenant = require('../src/models/Tenant');
const Account = require('../src/models/Account');

async function purgeDefault() {
  await connectDB();
  console.log('🗑️ Purging default demo tenant...');
  await Tenant.deleteMany({ $or: [{ isDefault: true }, { tenantId: 'default' }, { hotelCode: 1010 }, { hotelCode: '1010' }] });
  await Account.deleteMany({ tenantId: 'default' });
  console.log('✅ Default demo hotel completely removed from database!');
  process.exit(0);
}

purgeDefault().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
