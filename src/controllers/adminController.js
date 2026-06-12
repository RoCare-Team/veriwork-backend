import * as adminService from '../services/adminService.js';

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
