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

async function testResetFlow() {
  console.log('🔌 Connecting to MongoDB Atlas...');
  await connectDB();
  
  const tenantId = 'default';
  console.log('🗑️ Executing Full Hotel Reset for tenant:', tenantId);

  await store.resetTenant(tenantId);

  console.log('\n🔎 Verifying MongoDB Document Counts post-reset:\n');

  const counts = {
    StoreEntry: await StoreEntry.countDocuments({ tenantId }),
    Room: await Room.countDocuments({ tenantId }),
    RoomType: await RoomType.countDocuments({ tenantId }),
    Booking: await Booking.countDocuments({ tenantId }),
    Guest: await Guest.countDocuments({ tenantId }),
    Property: await Property.countDocuments({ tenantId }),
    AuditLog: await AuditLog.countDocuments({ tenantId }),
    RatePlan: await RatePlan.countDocuments({ tenantId }),
    Addon: await Addon.countDocuments({ tenantId }),
    TaxRule: await TaxRule.countDocuments({ tenantId }),
    CorporateAccount: await CorporateAccount.countDocuments({ tenantId }),
    Deposit: await Deposit.countDocuments({ tenantId }),
    Folio: await Folio.countDocuments({ tenantId }),
    NightAudit: await NightAudit.countDocuments({ tenantId }),
    Payment: await Payment.countDocuments({ tenantId }),
  };

  console.table(counts);

  const totalRemaining = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalRemaining === 0) {
    console.log('\n✅ RESET VERIFICATION SUCCESSFUL: 0 documents remaining in MongoDB. Hotel database is completely clean!');
  } else {
    console.error('\n❌ RESET FAILED: Some records still remain!');
  }

  process.exit(0);
}

testResetFlow().catch((err) => {
  console.error('❌ Reset error:', err);
  process.exit(1);
});
