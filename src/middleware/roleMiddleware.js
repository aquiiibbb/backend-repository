const { errorResponse } = require('../utils/apiResponse');
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return errorResponse(
        res,
        `User role '${req.user ? req.user.role : 'Guest'}' is not authorized to perform this action`,
        403
      );
    }
    next();
  };
};

module.exports = { authorize };