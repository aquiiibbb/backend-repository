const DEV_FALLBACK = 'super_secret_pms_jwt_key_2026_change_in_production';
function jwtSecret() {
  const s = process.env.JWT_SECRET || DEV_FALLBACK;
  if (process.env.NODE_ENV === 'production' && s === DEV_FALLBACK) {
    throw new Error('JWT_SECRET must be set to a strong random value in production');
  }
  return s;
}

module.exports = { jwtSecret };
