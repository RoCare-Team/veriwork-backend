export function preprocessProfileBody(req, _res, next) {
  if (req.body.phone && typeof req.body.phone === 'string') {
    req.body.phone = req.body.phone.replace(/\s+/g, '');
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
