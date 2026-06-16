import mongoose from 'mongoose';
import { env } from './env.js';
import { isMongoAuthError } from '../utils/mongoErrors.js';

function maskMongoUri(uri) {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}

export async function connectDatabase() {
  mongoose.set('strictQuery', true);

  const uri = env.mongodbUri;

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      maxPoolSize: 10,
    });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
  } catch (err) {
    console.error('\nCould not connect to MongoDB.');
    console.error(`URI: ${maskMongoUri(uri)}`);

    if (isMongoAuthError(err)) {
      console.error('\nMongoDB auth failed. Common fixes:');
      console.error('  1. Reset database user password in MongoDB Atlas');
      console.error('  2. Update MONGODB_URI on Vercel with correct username/password');
      console.error('  3. URL-encode special characters in password (e.g. @ → %40, # → %23)');
      console.error('  4. Example: mongodb+srv://USER:PASSWORD@cluster.mongodb.net/veriwork?retryWrites=true&w=majority\n');
    } else if (err.name === 'MongooseServerSelectionError') {
      console.error('\nQuick fix — MongoDB Atlas:');
      console.error('  1. Network Access → Add IP → Allow access from anywhere (0.0.0.0/0)');
      console.error('  2. Database Access → ensure user has read/write on cluster');
      console.error('  3. Set MONGODB_URI in Vercel Environment Variables\n');
    }

    throw err;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function getDatabaseStatus() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const readyState = mongoose.connection.readyState;
  return {
    status: states[readyState] || 'unknown',
    connected: readyState === 1,
    name: mongoose.connection.name || null,
  };
}
