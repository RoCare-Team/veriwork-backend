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

const allowedOrigins = env.corsOrigin
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS origin denied: ${origin}`));
  },
};

async function ensureDbConnected() {
  if (mongoose.connection.readyState === 1) return;

  if (!dbConnectPromise) {
    dbConnectPromise = connectDatabase()
      .catch((err) => {
        dbConnectPromise = null;
        throw err;
      });
  }

  await dbConnectPromise;
}

app.use(helmet());
app.use(cors(corsOptions));
app.use(morgan(env.isDev ? 'dev' : 'combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  const db = getDatabaseStatus();
  res.status(db.connected ? 200 : 503).json({
    success: db.connected,
    message: db.connected ? 'VeriWork API is running' : 'API up but database not connected',
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
