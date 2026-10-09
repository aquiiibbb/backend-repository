// Which browser-storage keys are persisted to MongoDB, and which stay in the browser only.
const LOCAL_ONLY = new Set([
  'pms_token', 'pms_user', 'pms_authenticated', 'pms_tenant_id', 'pms_synced_tenant', 'pms_theme',
  'pms_active_shift', 'pms_night_audit_prompt_dismissed_time_v1', 'pms_impersonating', 'pms_last_hotel',
  'superadmin_token', 'superadmin_user', 'GOOGLE_VISION_API_KEY', 'MINDEE_API_KEY',
  // Derived full copies of the db (already covered by the individual keys) - skipped to avoid 4x duplication
  'hotelpms_mock_db_v1', 'hotelpms_mock_db',
]);

const KEY_RE = /^[A-Za-z0-9_.\-]{1,120}$/;

function isSyncableKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return false;
  if (LOCAL_ONLY.has(key)) return false;
  return key.startsWith('hotelpms_') || key.startsWith('pms_');
}

const USERS_KEY = 'hotelpms_users_v1';
const BOOKINGS_KEY = 'hotelpms_bookings_v1';

// Keys that the public Booking Engine / Guest Self Check-in pages are allowed to read without a login
const PUBLIC_READ_RE =
  /^hotelpms_(hotel_info|hotel_terms|cancellation_policies|room_types|room_numbers|rooms_list|rate_plans|daily_rates_matrix|addons|taxes|tax_inclusive|ibe_room_displays|yield_status|yield_rules|working_business_date|reservation_sources|daily_channel_restrictions|channel_restrictions|sequence_config)(_v\d+)?$|^pms_hotel_profile$/;

function isPublicReadKey(key) {
  return PUBLIC_READ_RE.test(key);
}

module.exports = { isSyncableKey, isPublicReadKey, USERS_KEY, BOOKINGS_KEY, LOCAL_ONLY };
