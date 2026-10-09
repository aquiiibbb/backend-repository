/**
 * Unique Identifier Generator Utilities for Reservations, Payments, and Folio Items
 */

// Generate Reservation Code (e.g. RES-2026-9482)
exports.generateResCode = () => {
  const year = new Date().getFullYear();
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `RES-${year}-${randomNum}`;
};

// Generate Booking ID (e.g. BK-849201)
exports.generateBookingId = () => {
  return `BK-${Date.now().toString().slice(-6)}`;
};

// Generate Payment / Transaction ID (e.g. pay
/**
 * Unique Identifier Generator Utilities for Reservations, Payments, and Folio Items
 */

// Generate Reservation Code (e.g. RES-2026-9482)
exports.generateResCode = () => {
  const year = new Date().getFullYear();
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `RES-${year}-${randomNum}`;
};

// Generate Booking ID (e.g. BK-849201)
exports.generateBookingId = () => {
  return `BK-${Date.now().toString().slice(-6)}`;
};

// Generate Transaction ID (e.g. pay_1712849201)
exports.generateTransactionId = (prefix = 'pay') => {
  return `${prefix}_${Date.now()}`;
};