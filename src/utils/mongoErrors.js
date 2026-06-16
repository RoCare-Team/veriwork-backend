import { ApiError } from './ApiError.js';

export function isMongoAuthError(err) {
  if (!err) return false;
  return (
    err.name === 'MongoServerError'
    && (err.code === 18 || err.codeName === 'AuthenticationFailed' || /bad auth/i.test(err.message || ''))
  );
}

export function isMongoConnectionError(err) {
  if (!err) return false;
  return (
    isMongoAuthError(err)
    || err.name === 'MongooseServerSelectionError'
    || err.name === 'MongoNetworkError'
    || err.name === 'MongoTimeoutError'
  );
}

export function toMongoApiError(err) {
  if (isMongoAuthError(err)) {
    return ApiError.serviceUnavailable(
      'Database authentication failed. Check MONGODB_URI username/password on the server (URL-encode special characters in password).',
      { code: 'DB_AUTH_FAILED' },
    );
  }

  if (err.name === 'MongooseServerSelectionError' || err.name === 'MongoNetworkError') {
    return ApiError.serviceUnavailable(
      'Database is unreachable. Verify MONGODB_URI and allow Vercel IPs in MongoDB Atlas Network Access.',
      { code: 'DB_UNREACHABLE' },
    );
  }

  if (err.name === 'MongoTimeoutError' || /buffering timed out/i.test(err.message || '')) {
    return ApiError.serviceUnavailable(
      'Database connection timed out. Verify MONGODB_URI and cluster availability.',
      { code: 'DB_TIMEOUT' },
    );
  }

  return null;
}
