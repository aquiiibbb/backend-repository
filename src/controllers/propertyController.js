const Property = require('../models/Property');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Get Hotel Property Settings & Tax Rules
// @route   GET /api/property
// @access  Private
exports.getProperty = async (req, res, next) => {
  try {
    let property = await Property.findOne({ propertyId: 'prop_main' });
    if (!property) {
      property = await Property.create({ propertyId: 'prop_main' });
    }
    return successResponse(res, 'Property settings retrieved', property);
  } catch (err) {
    next(err);
  }
};

// @desc    Update Property Master Settings & Tax Rules
// @route   PUT /api/property
// @access  Private (Manager / SuperAdmin)
exports.updateProperty = async (req, res, next) => {
  try {
    let property = await Property.findOne({ propertyId: 'prop_main' });
    if (!property) {
      property = new Property({ propertyId: 'prop_main' });
    }

    const { name, address, phone, email, currency, currencySymbol, checkInTime, checkOutTime, taxRules } = req.body;

    if (name) property.name = name;
    if (address) property.address = address;
    if (phone) property.phone = phone;
    if (email) property.email = email;
    if (currency) property.currency = currency;
    if (currencySymbol) property.currencySymbol = currencySymbol;
    if (checkInTime) property.checkInTime = checkInTime;
    if (checkOutTime) property.checkOutTime = checkOutTime;
    if (Array.isArray(taxRules)) property.taxRules = taxRules;

    await property.save();
    return successResponse(res, 'Property settings updated', property);
  } catch (err) {
    next(err);
  }
};