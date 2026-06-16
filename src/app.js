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
import { connectDatabase } from './config/database.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();
let dbConnectPromise = null;

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
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(morgan(env.isDev ? 'dev' : 'combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(async (_req, _res, next) => {
  try {
    await ensureDbConnected();
    next();
  } catch (err) {
    next(err);
  }
});

app.use('/uploads', express.static(path.resolve(env.upload.dir)));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'VeriWork API is running' });
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
