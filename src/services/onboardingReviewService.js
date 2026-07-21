import { Company } from '../models/Company.js';
import { CompanyOnboarding } from '../models/CompanyOnboarding.js';
import { OnboardingMessage } from '../models/OnboardingMessage.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { assertValidObjectId } from '../utils/objectId.js';
import { sendOnboardingDocumentRejectedEmail } from './emailService.js';

/**
 * Mongoose Map -> plain object.
 *
 * Order matters: a MongooseMap IS a Map, and its `toObject()` returns *another
 * Map*, not a plain object. Checking `toObject` first therefore yields something
 * whose bracket access is always undefined — which silently broke document
 * lookups. Handle the Map case first, and unwrap `toObject()` if it also
 * returns one.
 */
function mapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value.toObject === 'function') {
    const plain = value.toObject();
    return plain instanceof Map ? Object.fromEntries(plain) : plain;
  }
  return value;
}

export function mapDocumentReviews(onboarding) {
  const reviews = mapToObject(onboarding.documentReviews);
  return Object.entries(reviews).reduce((acc, [key, review]) => {
    acc[key] = {
      status: review?.status || 'pending',
      reason: review?.reason || '',
      reviewedAt: review?.reviewedAt || null,
    };
    return acc;
  }, {});
}

function mapMessage(message) {
  return {
    id: message._id,
    authorRole: message.authorRole,
    authorName: message.authorName || (message.authorRole === 'admin' ? 'Compliance team' : 'You'),
    body: message.body,
    documentKey: message.documentKey || '',
    isSystem: message.isSystem,
    createdAt: message.createdAt,
  };
}

async function getOnboardingOrThrow(companyId) {
  const onboarding = await CompanyOnboarding.findOne({ companyId });
  if (!onboarding) throw ApiError.notFound('Onboarding application not found');
  return onboarding;
}

async function addSystemMessage(companyId, body, documentKey = '') {
  await OnboardingMessage.create({
    companyId,
    authorRole: 'admin',
    authorName: 'PagerLook',
    body,
    documentKey,
    isSystem: true,
  });
}

/* ---------------------------------- Admin ---------------------------------- */

/**
 * Approve or reject a single document. Rejecting moves the whole application to
 * `changes_requested` so the company can re-upload just that file.
 */
export async function reviewOnboardingDocument(adminUserId, companyId, payload) {
  const validCompanyId = assertValidObjectId(companyId, 'company id');
  const onboarding = await getOnboardingOrThrow(validCompanyId);

  const { documentKey, status, reason } = payload;
  const documents = mapToObject(onboarding.documents);
  if (!documents[documentKey]) {
    throw ApiError.badRequest('That document has not been uploaded');
  }
  if (status === 'rejected' && !reason?.trim()) {
    throw ApiError.badRequest('A reason is required when rejecting a document');
  }

  onboarding.documentReviews.set(documentKey, {
    status,
    reason: status === 'rejected' ? reason.trim() : '',
    reviewedAt: new Date(),
    reviewedBy: adminUserId,
  });

  if (status === 'rejected') {
    // Reopen the application for edits without losing the other documents.
    onboarding.status = 'changes_requested';
    await onboarding.save();

    await OnboardingMessage.create({
      companyId: validCompanyId,
      authorRole: 'admin',
      authorName: 'Compliance team',
      body: reason.trim(),
      documentKey,
      isSystem: false,
    });

    const [company, admin] = await Promise.all([
      Company.findById(validCompanyId).select('name workEmail'),
      User.findOne({ companyId: validCompanyId, role: 'enterprise_admin' }).select('email'),
    ]);
    const to = admin?.email || company?.workEmail;
    if (to) {
      await sendOnboardingDocumentRejectedEmail({
        to,
        companyName: company?.name || 'your company',
        documentKey,
        reason: reason.trim(),
      });
    }
  } else {
    await onboarding.save();
  }

  return {
    documentKey,
    status,
    applicationStatus: onboarding.status,
    documentReviews: mapDocumentReviews(onboarding),
  };
}

export async function listOnboardingMessages(companyId, { asAdmin = false } = {}) {
  const validCompanyId = assertValidObjectId(companyId, 'company id');
  const messages = await OnboardingMessage.find({ companyId: validCompanyId }).sort({ createdAt: 1 });

  // Opening the thread marks the other side's messages as read.
  const readField = asAdmin ? 'readByAdmin' : 'readByCompany';
  await OnboardingMessage.updateMany(
    { companyId: validCompanyId, [readField]: false },
    { $set: { [readField]: true } },
  );

  return { messages: messages.map(mapMessage) };
}

export async function postOnboardingMessage(companyId, { body, authorRole, user, documentKey = '' }) {
  const validCompanyId = assertValidObjectId(companyId, 'company id');
  if (!body?.trim()) throw ApiError.badRequest('Message cannot be empty');

  let authorName = 'Compliance team';
  if (authorRole === 'company') {
    const company = await Company.findById(validCompanyId).select('name');
    authorName = company?.name || 'Company';
  }

  const message = await OnboardingMessage.create({
    companyId: validCompanyId,
    authorRole,
    authorUserId: user?._id || null,
    authorName,
    body: body.trim(),
    documentKey,
    readByCompany: authorRole === 'company',
    readByAdmin: authorRole === 'admin',
  });

  return mapMessage(message);
}

/* --------------------------------- Company --------------------------------- */

/** What the employer sees on their pending-approval screen. */
export async function getMyApplicationStatus(user) {
  if (!user?.companyId) throw ApiError.forbidden('No company associated with this account');
  const onboarding = await getOnboardingOrThrow(user.companyId);

  const reviews = mapDocumentReviews(onboarding);
  const rejected = Object.entries(reviews)
    .filter(([, r]) => r.status === 'rejected')
    .map(([key, r]) => ({ documentKey: key, reason: r.reason, reviewedAt: r.reviewedAt }));

  const unread = await OnboardingMessage.countDocuments({
    companyId: user.companyId,
    authorRole: 'admin',
    readByCompany: false,
  });

  return {
    status: onboarding.status,
    rejectionReason: onboarding.rejectionReason || '',
    reviewedAt: onboarding.reviewedAt || null,
    submittedAt: onboarding.updatedAt,
    documentReviews: reviews,
    rejectedDocuments: rejected,
    canResubmit: onboarding.status === 'changes_requested' && rejected.length === 0,
    unreadMessages: unread,
  };
}

/**
 * Send a fixed application back for review. Only allowed once every rejected
 * document has actually been replaced (re-uploading resets it to pending).
 */
export async function resubmitApplication(user) {
  if (!user?.companyId) throw ApiError.forbidden('No company associated with this account');
  const onboarding = await getOnboardingOrThrow(user.companyId);

  if (onboarding.status !== 'changes_requested') {
    throw ApiError.badRequest('This application is not awaiting changes');
  }

  const reviews = mapDocumentReviews(onboarding);
  const stillRejected = Object.entries(reviews).filter(([, r]) => r.status === 'rejected');
  if (stillRejected.length > 0) {
    throw ApiError.badRequest(
      `Re-upload the rejected document${stillRejected.length > 1 ? 's' : ''} before resubmitting`,
    );
  }

  onboarding.status = 'submitted';
  await onboarding.save();

  await addSystemMessage(user.companyId, 'Application resubmitted for review.');

  return { status: onboarding.status, message: 'Application resubmitted for review' };
}
