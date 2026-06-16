import { AccessRequest } from '../models/AccessRequest.js';
import { ActivityLog } from '../models/ActivityLog.js';
import { ApiError } from '../utils/ApiError.js';

const REQUEST_TYPES = new Set(['consent_request', 'access_request']);

function formatActivity(activity) {
  return {
    id: activity._id,
    type: activity.type,
    title: activity.title,
    message: activity.message,
    company: activity.company,
    status: activity.status,
    metadata: activity.metadata || {},
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
}

function isRequest(activity) {
  return REQUEST_TYPES.has(activity.type);
}

function isPendingRequest(activity) {
  return isRequest(activity) && activity.status === 'pending';
}

export async function listActivity(userId, query = {}) {
  const activities = await ActivityLog.find({ userId }).sort({ createdAt: -1 });
  const formatted = activities.map(formatActivity);

  const pendingRequests = formatted.filter(isPendingRequest);
  const recentUpdates = formatted.filter((activity) => !isPendingRequest(activity));

  const filter = query.filter || 'all';
  if (filter === 'requests') {
    return {
      filter,
      pendingRequests: formatted.filter(isRequest),
      recentUpdates: [],
      items: formatted.filter(isRequest),
    };
  }

  if (filter === 'updates') {
    return {
      filter,
      pendingRequests: [],
      recentUpdates,
      items: recentUpdates,
    };
  }

  return {
    filter: 'all',
    pendingRequests,
    recentUpdates,
    items: formatted,
  };
}

async function syncAccessRequestFromActivity(activity, employeeStatus) {
  const accessRequestId = activity.metadata?.accessRequestId;
  if (!accessRequestId) return null;

  const statusMap = {
    approved: 'approved',
    denied: 'rejected',
  };

  const mappedStatus = statusMap[employeeStatus];
  if (!mappedStatus) return null;

  const accessRequest = await AccessRequest.findById(accessRequestId);
  if (!accessRequest) return null;

  accessRequest.status = mappedStatus;
  accessRequest.respondedAt = new Date();
  await accessRequest.save();

  return accessRequest;
}

export async function updateActivityStatus(userId, activityId, status) {
  const activity = await ActivityLog.findOne({ _id: activityId, userId });
  if (!activity) throw ApiError.notFound('Activity not found');

  if (!isRequest(activity)) {
    throw ApiError.badRequest('Only access or consent requests can be approved or denied');
  }

  if (activity.status !== 'pending') {
    throw ApiError.badRequest('This request has already been responded to');
  }

  activity.status = status;
  await activity.save();

  if (activity.type === 'access_request' || activity.type === 'consent_request') {
    await syncAccessRequestFromActivity(activity, status);
  }

  return formatActivity(activity);
}

export async function createActivity(userId, data) {
  const activity = await ActivityLog.create({ userId, ...data });
  return formatActivity(activity);
}
