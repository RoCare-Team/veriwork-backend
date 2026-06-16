import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { AccessRequest } from '../models/AccessRequest.js';

async function migrate() {
  await connectDatabase();

  const requests = await AccessRequest.find({
    $or: [
      { employeeId: { $exists: false } },
      { employeeId: null },
      { requestedAt: { $exists: false } },
    ],
  });

  let updated = 0;
  for (const request of requests) {
    if (!request.employeeId && request.employeeUserId) {
      request.employeeId = request.employeeUserId;
    }
    if (!request.requestedAt) {
      request.requestedAt = request.createdAt || new Date();
    }
    if (request.status === 'accepted') {
      request.status = 'approved';
    }
    await request.save();
    updated += 1;
  }

  console.log(`Linking migration complete. Updated records: ${updated}`);
  await disconnectDatabase();
}

migrate().catch(async (error) => {
  console.error('Linking migration failed:', error);
  await disconnectDatabase();
  process.exit(1);
});
