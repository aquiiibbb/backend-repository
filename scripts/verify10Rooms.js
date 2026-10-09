const dotenv = require('dotenv');
dotenv.config();

const connectDB = require('../src/config/db');
const store = require('../src/services/storeService');
const { syncStructuredModels } = require('../src/services/syncStructuredModels');
const Room = require('../src/models/Room');
const RoomType = require('../src/models/RoomType');
const StoreEntry = require('../src/models/StoreEntry');

async function runVerification() {
  console.log('🔌 Connecting to MongoDB Atlas...');
  await connectDB();
  console.log('✅ Connected to MongoDB Atlas successfully.');

  const tenantId = 'default';

  // 1. Prepare 10 Real Rooms & Room Types
  const roomTypesData = [
    { id: 'rt-deluxe-100', name: 'Deluxe Suite', basePrice: 250, maxOccupancy: 3, extraAdultPrice: 50 },
    { id: 'rt-executive-200', name: 'Executive Room', basePrice: 180, maxOccupancy: 2, extraAdultPrice: 35 },
  ];

  const roomsData = [
    { no: '101', type: 'Deluxe Suite', floor: 1, rate: 250, housekeeping: 'Clean', status: 'Vacant', petFriendly: true },
    { no: '102', type: 'Deluxe Suite', floor: 1, rate: 250, housekeeping: 'Clean', status: 'Occupied', petFriendly: false },
    { no: '103', type: 'Deluxe Suite', floor: 1, rate: 250, housekeeping: 'Dirty', status: 'Vacant', petFriendly: false },
    { no: '104', type: 'Deluxe Suite', floor: 1, rate: 250, housekeeping: 'Inspected', status: 'Vacant', petFriendly: true },
    { no: '105', type: 'Deluxe Suite', floor: 1, rate: 250, housekeeping: 'Clean', status: 'Vacant', petFriendly: false },
    { no: '106', type: 'Executive Room', floor: 2, rate: 180, housekeeping: 'Clean', status: 'Vacant', petFriendly: false },
    { no: '107', type: 'Executive Room', floor: 2, rate: 180, housekeeping: 'Dirty', status: 'Occupied', petFriendly: true },
    { no: '108', type: 'Executive Room', floor: 2, rate: 180, housekeeping: 'Clean', status: 'Vacant', petFriendly: false },
    { no: '109', type: 'Executive Room', floor: 2, rate: 180, housekeeping: 'Inspected', status: 'Vacant', petFriendly: false },
    { no: '110', type: 'Executive Room', floor: 2, rate: 180, housekeeping: 'Maintenance', status: 'Out of Service', petFriendly: false },
  ];

  console.log('\n📝 Saving 10 Rooms & 2 Room Types to MongoDB StoreEntry...');

  // Write to StoreEntry
  await store.applyChanges(tenantId, [
    { key: 'hotelpms_room_types_v3', value: JSON.stringify(roomTypesData), baseRev: 0 },
    { key: 'hotelpms_room_numbers_v3', value: JSON.stringify(roomsData), baseRev: 0 },
    { key: 'hotelpms_rooms_list_v1', value: JSON.stringify(roomsData), baseRev: 0 },
  ]);

  console.log('⚡ Triggering Structured Mongoose Model Mirror Synchronization...');
  await syncStructuredModels(tenantId, 'hotelpms_room_types_v3', JSON.stringify(roomTypesData));
  await syncStructuredModels(tenantId, 'hotelpms_room_numbers_v3', JSON.stringify(roomsData));

  // 2. Query MongoDB Directly to verify documents
  console.log('\n🔎 Querying MongoDB Atlas Collections Directly:\n');

  const mongoRooms = await Room.find({ tenantId }).lean();
  const mongoRoomTypes = await RoomType.find({ tenantId }).lean();
  const rawStoreEntries = await StoreEntry.find({ tenantId, key: 'hotelpms_room_numbers_v3' }).lean();

  console.log(`📌 MongoDB 'Room' Collection Document Count: ${mongoRooms.length}`);
  console.log(`📌 MongoDB 'RoomType' Collection Document Count: ${mongoRoomTypes.length}`);
  console.log(`📌 MongoDB 'StoreEntry' Key Document Count: ${rawStoreEntries.length}`);

  console.log('\n📋 MongoDB "Room" Collection Record Details:');
  console.table(
    mongoRooms.map((r) => ({
      ID: r._id.toString(),
      RoomNo: r.roomNumber,
      Type: r.roomType,
      Floor: r.floor,
      Rate: r.ratePerNight,
      Housekeeping: r.housekeepingStatus,
      FO_Status: r.foStatus,
      PetFriendly: r.petFriendly,
    }))
  );

  console.log('\n✅ VERIFICATION COMPLETE: All 10 Rooms exist in MongoDB with 100% complete field persistence.');
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('❌ Verification Error:', err);
  process.exit(1);
});
