import mongoose from 'mongoose';

/**
 * A message on a company's onboarding application — the thread the employer and
 * the compliance admin use to sort out documents ("why was GST rejected?",
 * "when will this be approved?"). Scoped to the application rather than being a
 * standalone support desk, so context is never lost.
 */
const onboardingMessageSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    // Who wrote it — drives which side of the thread it renders on.
    authorRole: {
      type: String,
      enum: ['company', 'admin'],
      required: true,
    },
    authorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    authorName: { type: String, default: '' },
    body: { type: String, required: true, trim: true },
    // Set when the message is about a specific document (e.g. a rejection note).
    documentKey: { type: String, default: '' },
    // System notes (status changes) render differently from typed messages.
    isSystem: { type: Boolean, default: false },
    readByCompany: { type: Boolean, default: false },
    readByAdmin: { type: Boolean, default: false },
  },
  { timestamps: true },
);

onboardingMessageSchema.index({ companyId: 1, createdAt: 1 });

export const OnboardingMessage = mongoose.model('OnboardingMessage', onboardingMessageSchema);
