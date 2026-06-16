import * as authService from '../services/authService.js';

export async function sendEmployeeOtp(req, res) {
  const result = await authService.employeeSendOtp(req.body.phone);
  res.json({ success: true, data: result });
}

export async function verifyEmployeeOtp(req, res) {
  const result = await authService.employeeVerifyOtp(req.body.phone, req.body.code);
  res.json({ success: true, data: result });
}

export async function employeeGoogleLogin(req, res) {
  const result = await authService.employeeGoogleLogin(req.body.idToken);
  res.json({ success: true, data: result });
}

export async function enterpriseLogin(req, res) {
  const result = await authService.enterpriseLogin(req.body.email, req.body.password);
  res.json({ success: true, data: result });
}

export async function platformAdminLogin(req, res) {
  const result = await authService.platformAdminLogin(req.body.email, req.body.password);
  res.json({ success: true, data: result });
}

export async function enterpriseRegister(req, res) {
  const result = await authService.enterpriseRegister(req.body);
  res.status(201).json({ success: true, data: result });
}

export async function refresh(req, res) {
  const result = await authService.refreshTokens(req.body.refreshToken);
  res.json({ success: true, data: result });
}

export async function logout(req, res) {
  const result = await authService.logout(req.body.refreshToken, req.user?._id);
  res.json({ success: true, data: result });
}
