import { Endorsement } from '../models/Endorsement.js';
import { EmployeeProfile } from '../models/EmployeeProfile.js';
import { ApiError } from '../utils/ApiError.js';
import { refreshCachedScore } from './employeeProfileService.js';

const MAX_ENDORSEMENTS = 8;

export async function listEmployeeEndorsements(userId) {
  const endorsements = await Endorsement.find({ employeeId: userId })
    .sort({ createdAt: -1 })
    .limit(20);

  return endorsements.map((item) => ({
    id: item._id,
    endorserName: item.endorserName,
    relationship: item.relationship,
    message: item.message,
    endorsedAt: item.createdAt,
  }));
}

export async function endorseEmployee(endorserUserId, { veriworkId, message = '', relationship = 'colleague' }) {
  const targetProfile = await EmployeeProfile.findOne({ veriworkId: veriworkId?.trim() });
  if (!targetProfile) throw ApiError.notFound('Employee not found with this PagerLook ID');

  if (targetProfile.userId.equals(endorserUserId)) {
    throw ApiError.badRequest('You cannot endorse yourself');
  }

  const endorserProfile = await EmployeeProfile.findOne({ userId: endorserUserId });
  if (!endorserProfile) throw ApiError.notFound('Your profile not found');

  const existing = await Endorsement.findOne({
    employeeId: targetProfile.userId,
    endorsedBy: endorserUserId,
  });
  if (existing) throw ApiError.conflict('You have already endorsed this professional');

  const count = await Endorsement.countDocuments({ employeeId: targetProfile.userId });
  if (count >= MAX_ENDORSEMENTS) {
    throw ApiError.badRequest('This employee has reached the maximum peer endorsements');
  }

  await Endorsement.create({
    employeeId: targetProfile.userId,
    endorsedBy: endorserUserId,
    endorserName: endorserProfile.name || 'Professional',
    relationship,
    message: message.trim(),
  });

  targetProfile.endorsements = count + 1;
  await targetProfile.save();
  await refreshCachedScore(targetProfile.userId);

  return {
    endorsements: targetProfile.endorsements,
    maxEndorsements: MAX_ENDORSEMENTS,
    veriScorePoints: Math.min(targetProfile.endorsements * 8, 60),
    message: 'Endorsement added successfully',
  };
}
