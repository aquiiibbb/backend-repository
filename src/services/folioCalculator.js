/**
 * Utility calculations for Folio Balances, Tariffs, and Tax Rules
 */

// Calculate itemized charges sum
exports.calculateFolioCharges = (items = []) => {
  return items.reduce((sum, item) => sum + (Number(item.amountUSD || item.amount) || 0), 0);
};

// Calculate tax amount based on percentage rate
exports.calculateTaxAmount = (amount = 0, taxPercentage = 12, isExempt = false) => {
  if (isExempt || !amount || amount <= 0) return 0;
  return Math.round((amount * (taxPercentage / 100)) * 100) / 100;
};

// Calculate remaining balance due
exports.calculateBalanceDue = (totalCharges = 0, totalPayments = 0) => {
  return Math.max(0, Math.round((totalCharges - totalPayments) * 100) / 100);
};