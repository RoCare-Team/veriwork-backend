import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import mongoose from 'mongoose';
import path from 'path';
import { env } from './config/env.js';
import { swaggerSpec } from './config/swagger.js';
import routes from './routes/index.js';
import { connectDatabase, getDatabaseStatus } from './config/database.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();
let dbConnectPromise = null;

// Origins allowed regardless of env config, so a missing/partial CORS_ORIGIN on the
// deployed host can never lock out the real frontend.
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://pagerlook.com',
  'https://www.pagerlook.com',
];

const configuredOrigins = env.corsOrigin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([...configuredOrigins, ...DEFAULT_ALLOWED_ORIGINS]);

function isOriginAllowed(origin) {
  // Allow non-browser clients (Postman, curl, server-to-server) — they send no Origin.
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }

  // Any pagerlook.com subdomain + Vercel deployments (production & previews).
  if (hostname === 'pagerlook.com' || hostname.endsWith('.pagerlook.com')) return true;
  if (hostname.endsWith('.vercel.app')) return true;

  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    // Deny without throwing — a thrown error becomes a 500 with no CORS headers,
    // which surfaces as an opaque "CORS error" in the browser.
    console.warn('[cors] blocked origin:', origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

async function ensureDbConnected() {
  if (mongoose.connection.readyState === 1) return;

  if (!dbConnectPromise) {
    dbConnectPromise = connectDatabase().catch((err) => {
      dbConnectPromise = null;
      throw err;
    });
  }

  await dbConnectPromise;
}

app.use(helmet());

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  console.log("Origin:", req.headers.origin);
  next();
});

app.use(morgan(env.isDev ? 'dev' : 'combined'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  const db = getDatabaseStatus();

  res.status(db.connected ? 200 : 503).json({
    success: db.connected,
    message: db.connected
      ? 'VeriWork API is running'
      : 'API up but database not connected',
    db,
  });
});

app.use(async (_req, _res, next) => {
  try {
    await ensureDbConnected();
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/uploads', express.static(path.resolve(env.upload.dir)));

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;