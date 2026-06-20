import * as companyLinkingService from '../services/companyLinkingService.js';
import * as verificationRequestService from '../services/verificationRequestService.js';
import * as workforceOnboardingService from '../services/workforceOnboardingService.js';
import { searchPlatformCompanies } from '../services/employmentVerificationService.js';
import { listAccessRequestTypes as getAccessRequestTypeOptions } from '../services/accessRequestTypesService.js';

function mapInvitation(invitation) {
  return {
    id: invitation._id || invitation.id,
    invitationId: invitation._id || invitation.id,
    companyId: invitation.companyId,
    employeeId: invitation.employeeId,
    employeeName: invitation.employeeName,
    employeeEmail: invitation.employeeEmail,
    employeeMobile: invitation.employeeMobile,
    employeeVeriworkId: invitation.employeeVeriworkId,
    department: invitation.department,
    designation: invitation.designation,
    status: invitation.status,
    invitedAt: invitation.invitedAt,
    caseType: invitation.caseType,
    emailSent: invitation.emailSent ?? false,
    emailMock: invitation.emailMock ?? false,
    registrationLink: invitation.registrationLink || null,
    joinLink: invitation.joinLink || null,
    dashboardStatus: invitation.dashboardStatus,
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

export async function getWorkspace(req, res) {
  const data = await companyLinkingService.getCompanyWorkspace(req.user);
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

export async function getEmployeeById(req, res) {
  const data = await companyLinkingService.getEmployeeProfilePreview(req.user, req.params.employeeId);
  res.json({ success: true, data });
}

export async function revokeEmployeeAccess(req, res) {
  const data = await companyLinkingService.revokeEmployeeAccess(
    req.user,
    req.params.employeeId,
    req.body,
  );
  res.json({ success: true, data });
}

export async function getEmployeeDocuments(req, res) {
  const data = await companyLinkingService.getEmployeeDocuments(req.user, req.params.employeeId);
  res.json({ success: true, data });
}

export async function getEmployeeAccessStatus(req, res) {
  const data = await companyLinkingService.getEmployeeAccessStatus(req.user, req.params.employeeId);
  res.json({ success: true, data });
}

export async function listAccessRequestTypes(req, res) {
  res.json({ success: true, data: getAccessRequestTypeOptions() });
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

export async function searchRegisteredCompanies(req, res) {
  const q = req.query.q || '';
  const companies = await searchPlatformCompanies(q, req.user.companyId);
  res.json({ success: true, data: { companies } });
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
  const data = await verificationRequestService.approveVerificationRequest(
    req.user,
    req.params.id,
    req.body,
  );
  res.json({ success: true, data });
}

export async function rejectVerificationRequest(req, res) {
  const data = await verificationRequestService.rejectVerificationRequest(
    req.user,
    req.params.id,
    req.body,
  );
  res.json({ success: true, data });
}

export async function reviewHrResponse(req, res) {
  const data = await verificationRequestService.reviewHrResponse(req.user, req.params.id, req.body);
  res.json({ success: true, data });
}

export async function confirmDocumentVerification(req, res) {
  const data = await verificationRequestService.confirmDocumentVerification(
    req.user,
    req.params.id,
    req.body,
  );
  res.json({ success: true, data });
}

export async function getEmployeeJobVerificationRecord(req, res) {
  const data = await verificationRequestService.getEmployeeJobVerificationRecord(
    req.user,
    req.params.employeeId,
    req.params.jobId,
  );
  res.json({ success: true, data });
}

export async function listPendingInvitations(req, res) {
  const data = await companyLinkingService.listPendingInvitations(req.user);
  res.json({ success: true, data });
}

export async function completeEmailVerification(req, res) {
  const data = await verificationRequestService.completeEmailVerification(req.user, req.params.id, req.body);
  res.json({ success: true, data });
}

export async function assignEmployeeOnboarding(req, res) {
  const data = await workforceOnboardingService.assignEmployeeOnboarding(
    req.user,
    req.params.employeeId,
    req.body,
  );
  res.json({ success: true, data });
}
