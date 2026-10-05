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

    // Digits in the code. The shared gateway sends 4; the local mock and the
    // savshka sender follow whatever is set here so one length rules the UI.
    length: Number(process.env.OTP_LENGTH) || 4,

    // Throttling. The gateway does not rate-limit, so this is ours to enforce:
    // a resend cooldown and an hourly cap keep anyone from running up an SMS
    // bill, and an attempt cap stops a short code being guessed.
    resendSeconds: Number(process.env.OTP_RESEND_SECONDS) || 30,
    maxPerHour: Number(process.env.OTP_MAX_PER_HOUR) || 5,
    windowMs: 60 * 60 * 1000,
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,

    // Shared SMS gateway that generates, sends AND verifies the code. Turns on
    // as soon as both URLs are set; otherwise OTP falls back to the savshka
    // sender below, or to the dev mock code when that is unconfigured too.
    gateway: {
      enabled: Boolean(process.env.OTP_SEND_URL && process.env.OTP_VERIFY_URL),
      sendUrl: process.env.OTP_SEND_URL || "",
      verifyUrl: process.env.OTP_VERIFY_URL || "",
      token: process.env.OTP_TOKEN || "",
      // The gateway keeps a list of permitted sources and rejects the rest.
      source: process.env.OTP_SOURCE || "pagerLook",
    },

    // Test numbers that always get a fixed OTP and never trigger a real SMS —
    // used for app-store/demo logins where a live SMS can't be received.
    // Comma-separated in OTP_TEST_PHONES; stored normalized (+91XXXXXXXXXX).
    testPhones: (process.env.OTP_TEST_PHONES || "7740847114")
      .split(",")
      .map((p) => p.replace(/\D/g, ""))
      .filter(Boolean)
      .map((d) => (d.length === 10 ? `+91${d}` : `+${d}`)),
    testCode: process.env.OTP_TEST_CODE || "123456",
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
    brandName: process.env.SMS_BRAND_NAME || "PagerLook",
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
    // 'capture' (default for now): just store the live selfie, no Rekognition
    // call and no Aadhaar comparison — the stored selfie is matched later once
    // DigiLocker provides the reference photo. 'match': full Rekognition flow.
    mode: process.env.FACE_MATCH_MODE === "match" ? "match" : "capture",
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

  digilocker: {
    clientId: process.env.DIGILOCKER_CLIENT_ID || "",
    clientSecret: process.env.DIGILOCKER_CLIENT_SECRET || "",
    redirectUri: process.env.DIGILOCKER_REDIRECT_URI || "",
    authorizationUrl: process.env.DIGILOCKER_AUTHORIZATION_URL || "",
    tokenUrl: process.env.DIGILOCKER_TOKEN_URL || "",
    userInfoUrl: process.env.DIGILOCKER_USERINFO_URL || "",
    documentsUrl: process.env.DIGILOCKER_DOCUMENTS_URL || "",
    scopes: (process.env.DIGILOCKER_SCOPES || "").trim(),
    tokenAuthMethod: process.env.DIGILOCKER_TOKEN_AUTH_METHOD || "client_secret_post",
    stateTtlSeconds: Number(process.env.DIGILOCKER_STATE_TTL_SECONDS) || 600,
    frontendSuccessPath: process.env.DIGILOCKER_SUCCESS_PATH || "/employee/settings/digilocker?status=success",
    frontendFailurePath: process.env.DIGILOCKER_FAILURE_PATH || "/employee/settings/digilocker?status=failed",
  },

  // All outgoing transactional email is driven entirely by these env vars, so the
  // provider (Gmail today, Amazon SES later) can be swapped without code changes.
  email: {
    enabled: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),

    // ── Limbu Mail Studio HTTP API — the primary sender for ALL system email ──
    // Password resets, employment-verification mail, invites, notifications:
    // everything goes out over this HTTPS API instead of a raw SMTP socket, so
    // there is no connection pool to exhaust and no mailbox password on the box.
    // The sending identity (domain/from address) lives in the Mail Studio
    // account attached to MAIL_API_KEY, not here. SMTP_* below stays as the
    // automatic fallback for when the API is unreachable.
    api: {
      enabled: Boolean(process.env.MAIL_API_KEY),
      baseUrl: (process.env.MAIL_API_URL || "https://mail.limbutech.in").trim().replace(/\/$/, ""),
      apiKey: (process.env.MAIL_API_KEY || "").trim(),
      timeoutMs: Number(process.env.MAIL_API_TIMEOUT_MS) || 20000,
      // Network/5xx retries. Transactional mail is worth one more try.
      retries: Number(process.env.MAIL_API_RETRIES) || 2,
      // Optional overrides — the account's verified sender is used when unset.
      from: process.env.MAIL_API_FROM || "",
      fromName: process.env.MAIL_API_FROM_NAME || "",
      // When true, even companies with their own SMTP saved are sent through
      // the API. Off by default so the per-company "send from your own mailbox"
      // feature keeps working.
      force: process.env.MAIL_API_FORCE === "true",
    },

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
