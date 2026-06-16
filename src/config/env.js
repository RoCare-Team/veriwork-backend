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

  isDev: process.env.NODE_ENV !== "production",

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
  },
});
