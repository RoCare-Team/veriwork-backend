import { ActivityLog } from '../models/ActivityLog.js';
import { ApiError } from '../utils/ApiError.js';

export async function listActivity(userId) {
  return ActivityLog.find({ userId }).sort({ createdAt: -1 });
}

export async function updateActivityStatus(userId, activityId, status) {
  const activity = await ActivityLog.findOne({ _id: activityId, userId });
  if (!activity) throw ApiError.notFound('Activity not found');

  activity.status = status;
  await activity.save();
  return activity;
}

export async function createActivity(userId, data) {
  return ActivityLog.create({ userId, ...data });
}
