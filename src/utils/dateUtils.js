/**
 * Date Helper Utilities for Hotel PMS Business Operations
 */

// Get Current ISO Date String (YYYY-MM-DD)
exports.getTodayString = () => {
  return new Date().toISOString().split('T')[0];
};

// Format ISO string or Date object to readable format
exports.formatDateReadable = (dateInput) => {
  if (!dateInput) return 'N/A';
  const d = new Date(dateInput);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Calculate number of nights between two date strings (YYYY-MM-DD)
exports.calculateNights = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 1;
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 1;
};

// Add / Subtract Days to a YYYY-MM-DD Date String
exports.addDaysToDate = (dateString, days = 1) => {
  const d = new Date(dateString);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};