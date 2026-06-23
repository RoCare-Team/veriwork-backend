function parseJsonField(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function preprocessProfileBody(req, _res, next) {
  if (req.body.phone && typeof req.body.phone === 'string') {
    req.body.phone = req.body.phone.replace(/\s+/g, '');
  }

  if (req.body.education) {
    req.body.education = parseJsonField(req.body.education);
  }

  const same =
    req.body.sameAsCurrentAddress === true
    || req.body.sameAsCurrentAddress === 'true';

  if (same && req.body.currentAddress) {
    const city = req.body.currentCity?.trim() || '';
    const address = req.body.currentAddress.trim();
    req.body.permanentAddress = city ? `${address}, ${city}` : address;
    req.body.sameAsCurrentAddress = true;
  }

  next();
}
