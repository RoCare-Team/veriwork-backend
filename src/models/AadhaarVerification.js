import mongoose from 'mongoose';

// One manual Aadhaar KYC submission per employee. The employee uploads the
// front + back of the card and types the number; a platform admin eyeballs the
// images against the typed details and approves or rejects. Only an approved
// record flips EmployeeProfile.aadhaarVerified.
const storedImageSchema = new mongoose.Schema(
  {
    url: { type: String, default: '' },
    // S3 object key when AWS is configured — lets Rekognition read the image
    // directly from the bucket instead of us re-downloading it.
    key: { type: String, default: '' },
    originalName: { type: String, default: '' },
    mimeType: { type: String, default: '' },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const faceMatchSchema = new mongoose.Schema(
  {
    // 'rekognition' for a real AWS CompareFaces result, 'mock' when face match
    // is not configured (dev only) — never silently pretend a mock is real.
    provider: { type: String, default: '' },
    similarity: { type: Number, default: 0 },
    threshold: { type: Number, default: 0 },
    matched: { type: Boolean, default: false },
    livenessPassed: { type: Boolean, default: false },
    selfieUrl: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
  },
  { _id: false },
);

const aadhaarVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    // AES-256-GCM (utils/crypto.js). Never stored or logged in plain text.
    aadhaarNumberEnc: { type: String, required: true },
    // sha256 of the digits — uniqueness check only, not reversible.
    aadhaarNumberHash: { type: String, required: true, index: true },
    aadhaarLast4: { type: String, default: '' },
    nameOnAadhaar: { type: String, default: '' },
    dobOnAadhaar: { type: String, default: '' },
    genderOnAadhaar: {
      type: String,
      enum: ['male', 'female', 'other', ''],
      default: '',
    },
    addressOnAadhaar: { type: String, default: '' },
    frontImage: { type: storedImageSchema, default: () => ({}) },
    backImage: { type: storedImageSchema, default: () => ({}) },
    consentAccepted: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    submittedAt: { type: Date, default: Date.now },
    submissionCount: { type: Number, default: 1 },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewNotes: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    faceMatch: { type: faceMatchSchema, default: () => ({}) },
  },
  { timestamps: true },
);

aadhaarVerificationSchema.index({ status: 1, submittedAt: -1 });

export const AadhaarVerification = mongoose.model(
  'AadhaarVerification',
  aadhaarVerificationSchema,
);
