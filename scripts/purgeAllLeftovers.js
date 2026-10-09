const dotenv = require('dotenv');
dotenv.config();

const connectDB = require('../src/config/db');
const store = require('../src/services/storeService');
const Room = require('../src/models/Room');
const RoomType = require('../src/models/RoomType');
const Booking = require('../src/models/Booking');
const Guest = require('../src/models/Guest');
const Property = require('../src/models/Property');
const AuditLog = require('../src/models/AuditLog');
const RatePlan = require('../src/models/RatePlan');
const Addon = require('../src/models/Addon');
const TaxRule = require('../src/models/TaxRule');
const CorporateAccount = require('../src/models/CorporateAccount');
const Deposit = require('../src/models/Deposit');
const Folio = require('../src/models/Folio');
const NightAudit = require('../src/models/NightAudit');
const Payment = require('../src/models/Payment');
const StoreEntry = require('../src/models/StoreEntry');

async function purgeAllLeftovers() {
  console.log('🔌 Connecting to MongoDB Atlas...');
  await connectDB();
  console.log('✅ Connected to MongoDB Atlas.');

  console.log('\n🗑️ Purging ALL leftover tenant data (including "hotel-comfort", "default", etc.) across ALL MongoDB collections...');
  
  await store.resetTenant('all');

  console.log('\n🔎 Direct MongoDB Atlas Collection Counts post-purge:\n');

  const counts = {
    RoomType: await RoomType.countDocuments({}),
    Room: await Room.countDocuments({}),
    Booking: await Booking.countDocuments({}),
    Guest: await Guest.countDocuments({}),
    Property: await Property.countDocuments({}),
    AuditLog: await AuditLog.countDocuments({}),
    RatePlan: await RatePlan.countDocuments({}),
    Addon: await Addon.countDocuments({}),
    TaxRule: await TaxRule.countDocuments({}),
    CorporateAccount: await CorporateAccount.countDocuments({}),
    Deposit: await Deposit.countDocuments({}),
    Folio: await Folio.countDocuments({}),
    NightAudit: await NightAudit.countDocuments({}),
    Payment: await Payment.countDocuments({}),
    StoreEntry: await StoreEntry.countDocuments({}),
  };

  console.table(counts);

  const totalRemaining = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n Total documents remaining across ALL tenants in MongoDB Atlas: ${totalRemaining}`);
  
  if (totalRemaining === 0) {
    console.log('✅ SUCCESS: All leftover documents (including "hotel-comfort") are 100% purged from MongoDB Atlas.');
  }

  process.exit(0);
}

purgeAllLeftovers().catch((err) => {
  console.error('❌ Purge failed:', err);
  process.exit(1);
});
