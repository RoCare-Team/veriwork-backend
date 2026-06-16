import * as companyLinkingService from '../services/companyLinkingService.js';
import * as verificationRequestService from '../services/verificationRequestService.js';

function mapInvitation(invitation) {
  return {
    id: invitation._id,
    companyId: invitation.companyId,
    employeeId: invitation.employeeId,
    employeeEmail: invitation.employeeEmail,
    employeeMobile: invitation.employeeMobile,
    employeeVeriworkId: invitation.employeeVeriworkId,
    department: invitation.department,
    designation: invitation.designation,
    status: invitation.status,
    invitedAt: invitation.invitedAt,
  };
}

export async function inviteEmployee(req, res) {
  const invitation = await companyLinkingService.inviteEmployee(req.user, req.body);
  res.status(201).json({ success: true, data: mapInvitation(invitation) });
}

export async function getTeam(req, res) {
  const data = await companyLinkingService.getCompanyTeam(req.user);
  res.json({ success: true, data });
}

export async function getDepartmentTeam(req, res) {
  const department = decodeURIComponent(req.params.department);
  const data = await companyLinkingService.getDepartmentDetails(req.user, department);
  res.json({ success: true, data });
}

export async function getEmployeeProfile(req, res) {
  const data = await companyLinkingService.getEmployeeProfilePreview(req.user, req.params.employeeId);
  res.json({ success: true, data });
}

export async function createAccessRequest(req, res) {
  const data = await companyLinkingService.createCompanyAccessRequest(req.user, req.body);
  res.status(201).json({ success: true, data });
}

export async function listAccessRequests(req, res) {
  const data = await companyLinkingService.listCompanyAccessRequests(req.user);
  res.json({ success: true, data });
}

export async function getInsights(req, res) {
  const data = await companyLinkingService.getCompanyInsights(req.user);
  res.json({ success: true, data });
}

export async function listAuditLogs(req, res) {
  const data = await companyLinkingService.listCompanyAuditLogs(req.user, req.query);
  res.json({ success: true, data });
}

export async function createVerificationRequest(req, res) {
  const data = await verificationRequestService.createVerificationRequest(req.user, req.body);
  res.status(201).json({ success: true, data });
}

export async function listOutgoingVerificationRequests(req, res) {
  const data = await verificationRequestService.listOutgoingVerificationRequests(req.user);
  res.json({ success: true, data });
}

export async function listIncomingVerificationRequests(req, res) {
  const data = await verificationRequestService.listIncomingVerificationRequests(req.user);
  res.json({ success: true, data });
}

export async function approveVerificationRequest(req, res) {
  const data = await verificationRequestService.approveVerificationRequest(req.user, req.params.id);
  res.json({ success: true, data });
}

export async function rejectVerificationRequest(req, res) {
  const data = await verificationRequestService.rejectVerificationRequest(req.user, req.params.id);
  res.json({ success: true, data });
}

export async function completeEmailVerification(req, res) {
  const data = await verificationRequestService.completeEmailVerification(req.user, req.params.id, req.body);
  res.json({ success: true, data });
}
