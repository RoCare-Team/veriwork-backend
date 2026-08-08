import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, ".env.local"), override: false });

const devDefaults = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/veriwork",
  JWT_ACCESS_SECRET: "dev-access-secret-change-in-production-32chars",
  JWT_REFRESH_SECRET: "dev-refresh-secret-change-in-production-32chars",
};

const required = (key) => {
  let value = process.env[key] ?? devDefaults[key];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  value = value.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }

  return value;
};

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",

  port: parseInt(process.env.PORT, 10) || 3000,

  mongodbUri: required("MONGODB_URI"),

  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",

  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),

    accessExpiresIn:
      process.env.JWT_ACCESS_EXPIRES_IN || "15m",

    refreshExpiresIn:
      process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  otp: {
    mockCode: process.env.OTP_MOCK_CODE || "123456",
    expiresMinutes:
      Number(process.env.OTP_EXPIRES_MINUTES) || 10,
  },

  // SMS gateway (savshka) for phone OTP. When SMS_API_KEY is unset, OTP stays in
  // dev mock mode (fixed code, no SMS). The DLT template + sender must match the
  // registered content exactly, so those are env-driven, never hardcoded.
  sms: {
    enabled: Boolean(process.env.SMS_API_KEY),
    apiUrl: process.env.SMS_API_URL || "https://api.savshka.co.in/api/sms",
    apiKey: process.env.SMS_API_KEY || "",
    senderId: process.env.SMS_SENDER_ID || "TLGCRO",
    entityId: process.env.SMS_ENTITY_ID || "",
    otpTemplateId: process.env.SMS_OTP_TEMPLATE_ID || "",
    // Brand name embedded in the registered DLT template text.
    brandName: process.env.SMS_BRAND_NAME || "Ro Care India",
  },

  upload: {
    dir: process.env.UPLOAD_DIR || "uploads",
    maxFileSizeMb:
      Number(process.env.MAX_FILE_SIZE_MB) || 10,
  },

  aws: {
    enabled: Boolean(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY,
    ),
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    region: process.env.AWS_REGION || "ap-south-1",
    bucket: process.env.AWS_S3_BUCKET || "pager-look",
  },

  // Biometric face match runs on AWS Rekognition (CompareFaces + DetectFaces)
  // and reuses the S3 credentials, so it turns on as soon as AWS is configured.
  // Every threshold is env-driven so the strictness can be tuned without a deploy.
  faceMatch: {
    enabled:
      process.env.FACE_MATCH_ENABLED === "false"
        ? false
        : Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    region:
      process.env.AWS_REKOGNITION_REGION || process.env.AWS_REGION || "ap-south-1",
    // Similarity (0-100) the live selfie must reach against the Aadhaar photo.
    minSimilarity: Number(process.env.FACE_MATCH_MIN_SIMILARITY) || 85,
    // Rekognition's confidence that the detected region really is a face.
    minDetectionConfidence: Number(process.env.FACE_MATCH_MIN_CONFIDENCE) || 95,
    // Reject selfies taken at a steep angle — they wreck match accuracy.
    maxPoseDegrees: Number(process.env.FACE_MATCH_MAX_POSE_DEGREES) || 30,
    minSharpness: Number(process.env.FACE_MATCH_MIN_SHARPNESS) || 20,
    minBrightness: Number(process.env.FACE_MATCH_MIN_BRIGHTNESS) || 20,
    // Degrees of head turn required across the liveness frames — a held-up
    // printed photo cannot produce this.
    minYawSpread: Number(process.env.FACE_MATCH_MIN_YAW_SPREAD) || 18,
    maxAttempts: Number(process.env.FACE_MATCH_MAX_ATTEMPTS) || 8,
  },

  isDev: process.env.NODE_ENV !== "production",

  // Platform admin seeded at boot. Kept out of source so the console has its
  // own credentials rather than a shared, published default. In production
  // both must be set or the seed is skipped — see config/bootstrap.js.
  admin: {
    email: process.env.ADMIN_EMAIL || "",
    password: process.env.ADMIN_PASSWORD || "",
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
  },

  // CORS_ORIGIN may be a comma-separated allow-list, but a link needs exactly one
  // origin — take the first and drop any trailing slash.
  frontendUrl: (process.env.FRONTEND_URL || process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")[0]
    .trim()
    .replace(/\/$/, ""),

  // Key used to encrypt sensitive at-rest secrets (e.g. per-company SMTP passwords).
  encryptionKey:
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    devDefaults.JWT_ACCESS_SECRET,

  // All outgoing transactional email is driven entirely by these env vars, so the
  // provider (Gmail today, Amazon SES later) can be swapped without code changes.
  email: {
    enabled: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    // From-address. SMTP_FROM is the canonical name; EMAIL_FROM kept as a fallback.
    // If neither carries a display name, we still send a clean "PagerLook <user>".
    from:
      process.env.SMTP_FROM ||
      process.env.EMAIL_FROM ||
      (process.env.SMTP_USER
        ? `PagerLook <${process.env.SMTP_USER}>`
        : "PagerLook <noreply@pagerlook.com>"),
    replyTo: process.env.SMTP_REPLY_TO || process.env.EMAIL_REPLY_TO || "",
    smtpHost: process.env.SMTP_HOST || "",
    smtpPort: Number(process.env.SMTP_PORT) || 587,
    smtpSecure: process.env.SMTP_SECURE === "true",
    smtpUser: process.env.SMTP_USER || "",
    smtpPass: process.env.SMTP_PASS || "",

    // Dedicated sender for employment-verification emails. Same server as the
    // global SMTP (host/port/secure inherited); only the mailbox differs so
    // verification mail comes from verification@pagerlook.com. Optional — falls
    // back to the global sender when not configured.
    verification: {
      user: process.env.VERIFICATION_SMTP_USER || "",
      pass: process.env.VERIFICATION_SMTP_PASS || "",
      from:
        process.env.VERIFICATION_SMTP_FROM ||
        (process.env.VERIFICATION_SMTP_USER
          ? `PagerLook Verification <${process.env.VERIFICATION_SMTP_USER}>`
          : ""),
    },

    // Branding for the shared HTML template — also env-driven, no hardcoding.
    brandName: process.env.EMAIL_BRAND_NAME || "PagerLook",
    brandTagline: process.env.EMAIL_BRAND_TAGLINE || "Verify. Trust. Grow.",
    brandColor: process.env.EMAIL_BRAND_COLOR || "#1e3a8a",
    brandLogoUrl: process.env.EMAIL_LOGO_URL || "",
    supportEmail: process.env.EMAIL_SUPPORT || "info@pagerlook.com",
    // Contact channels rendered in the email footer. E.164, no separators —
    // the same value drives the tel: and wa.me links.
    supportPhone: process.env.EMAIL_SUPPORT_PHONE || "+918510099972",
    instagramUrl:
      process.env.EMAIL_INSTAGRAM_URL || "https://www.instagram.com/pagerlook/",
  },
});
