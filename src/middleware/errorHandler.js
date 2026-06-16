import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export function notFoundHandler(_req, _res, next) {
  next(ApiError.notFound('Route not found'));
}

export function errorHandler(err, _req, res, _next) {
  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Max 5MB for photos, 10MB for documents.'
        : err.message,
    });
  }

  const statusCode = err.statusCode || 500;
  const response = {
    success: false,
    message: err.message || 'Internal server error',
  };

  if (err.details) {
    response.details = err.details;
  }

  if (env.isDev && statusCode === 500 && !err.isOperational) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}
