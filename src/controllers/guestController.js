const Guest = require('../models/Guest');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// @desc    Get All Guests / Search CRM
// @route   GET /api/guests
// @access  Private
exports.getGuests = async (req, res, next) => {
  try {
    const { search } = req.query;
    let query = {};

    if (search) {
      query = {
        $or: [
          { guestName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { idNumber: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const guests = await Guest.find(query).sort({ updatedAt: -1 });
    return successResponse(res, 'Guest directory retrieved', guests);
  } catch (err) {
    next(err);
  }
};

// @desc    Create Guest Profile
// @route   POST /api/guests
// @access  Private
exports.createGuest = async (req, res, next) => {
  try {
    const { guestName, email, phone, address, country, idType, idNumber, vipStatus, notes } = req.body;
    const guestId = `gst_${Date.now()}`;

    const guest = await Guest.create({
      guestId,
      guestName,
      email,
      phone,
      address,
      country,
      idType,
      idNumber,
      vipStatus,
      notes
    });

    return successResponse(res, 'Guest profile created', guest, 201);
  } catch (err) {
    next(err);
  }
};

// @desc    Update Guest Info & Attach Scanned ID Documents
// @route   PUT /api/guests/:id
// @access  Private
exports.updateGuest = async (req, res, next) => {
  try {
    const guest = await Guest.findById(req.params.id);
    if (!guest) return errorResponse(res, 'Guest not found', 404);

    const { guestName, email, phone, address, country, idType, idNumber, vipStatus, notes, scannedDoc } = req.body;

    if (guestName) guest.guestName = guestName;
    if (email) guest.email = email;
    if (phone) guest.phone = phone;
    if (address) guest.address = address;
    if (country) guest.country = country;
    if (idType) guest.idType = idType;
    if (idNumber) guest.idNumber = idNumber;
    if (typeof vipStatus === 'boolean') guest.vipStatus = vipStatus;
    if (notes) guest.notes = notes;

    if (scannedDoc) {
      guest.scannedDocs.push(scannedDoc);
    }

    await guest.save();
    return successResponse(res, 'Guest profile updated', guest);
  } catch (err) {
    next(err);
  }
};