import * as adminService from '../services/adminService.js';
import * as onboardingReviewService from '../services/onboardingReviewService.js';
import * as aadhaarVerificationService from '../services/aadhaarVerificationService.js';
import * as verificationRequestService from '../services/verificationRequestService.js';

export async function reviewCompanyDocument(req, res) {
  const data = await onboardingReviewService.reviewOnboardingDocument(
    req.user._id,
    req.params.id,
    req.body,
  );
  res.json({ success: true, data });
}

export async function listCompanyMessages(req, res) {
  const data = await onboardingReviewService.listOnboardingMessages(req.params.id, { asAdmin: true });
  res.json({ success: true, data });
}

export async function postCompanyMessage(req, res) {
  const data = await onboardingReviewService.postOnboardingMessage(req.params.id, {
    body: req.body.body,
    authorRole: 'admin',
    user: req.user,
  });
  res.status(201).json({ success: true, data });
}

export async function getDashboard(req, res) {
  const stats = await adminService.getDashboardStats();
  res.json({ success: true, data: stats });
}

export async function listCompanies(req, res) {
  const applications = await adminService.listCompanyApplications(req.query.status);
  res.json({ success: true, data: applications });
}

export async function getCompany(req, res) {
  const application = await adminService.getCompanyApplication(req.params.id);
  res.json({ success: true, data: application });
}

export async function reviewCompany(req, res) {
  const result = await adminService.reviewCompanyApplication(
    req.user._id,
    req.params.id,
    req.body,
  );
  res.json({ success: true, data: result });
}

export async function listEmployees(req, res) {
  const employees = await adminService.listEmployees({
    q: req.query.q,
    status: req.query.status,
  });
  res.json({ success: true, data: employees });
}

export async function getEmployee(req, res) {
  const employee = await adminService.getEmployee(req.params.id);
  res.json({ success: true, data: employee });
}

export async function listVerificationRequests(req, res) {
  const data = await verificationRequestService.listVerificationRequestsForAdmin({
    status: req.query.status,
    q: req.query.q,
  });
  res.json({ success: true, data });
}

export async function resendVerificationRequest(req, res) {
  const data = await verificationRequestService.adminResendVerificationRequest(
    req.user._id,
    req.params.id,
    req.body,
  );
  res.json({ success: true, data });
}

export async function listAadhaarRequests(req, res) {
  const requests = await aadhaarVerificationService.listAadhaarRequests({
    status: req.query.status,
    q: req.query.q,
  });
  res.json({ success: true, data: requests });
}

export async function getAadhaarRequest(req, res) {
  const request = await aadhaarVerificationService.getAadhaarRequest(req.params.id);
  res.json({ success: true, data: request });
}

export async function reviewAadhaarRequest(req, res) {
  const result = await aadhaarVerificationService.reviewAadhaarRequest(
    req.user._id,
    req.params.id,
    req.body,
  );
  res.json({ success: true, data: result });
}
