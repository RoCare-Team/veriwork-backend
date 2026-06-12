import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(env.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
  } catch (err) {
    if (err.name === 'MongooseServerSelectionError') {
      console.error('\nCould not connect to MongoDB.');
      console.error(`URI: ${env.mongodbUri.replace(/\/\/.*@/, '//***@')}`);
      console.error('\nQuick fix — MongoDB Atlas (free, 2 min):');
      console.error('  1. Go to https://www.mongodb.com/atlas');
      console.error('  2. Create free cluster → Database → Connect → Drivers');
      console.error('  3. Copy connection string into .env as MONGODB_URI');
      console.error('  4. Network Access → Add IP → Allow from anywhere');
      console.error('  5. Run npm start again\n');
    }
    throw err;
  }
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
