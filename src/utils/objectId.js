import mongoose from 'mongoose';
import { ApiError } from './ApiError.js';

export function isValidObjectId(value) {
  if (value == null || value === '' || value === 'undefined' || value === 'null') {
    return false;
  }
  return mongoose.Types.ObjectId.isValid(String(value));
}

export function assertValidObjectId(value, label = 'id') {
  if (!isValidObjectId(value)) {
    throw ApiError.badRequest(`Invalid ${label}`);
  }
  return String(value);
}
