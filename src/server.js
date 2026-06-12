import app from './app.js';
import { connectDatabase } from './config/database.js';
import { ensurePlatformAdmin } from './config/bootstrap.js';
import { env } from './config/env.js';

async function start() {
  await connectDatabase();
  await ensurePlatformAdmin();
  app.listen(env.port, () => {
    console.log(`VeriWork API listening on http://localhost:${env.port}`);
    console.log(`Swagger docs: http://localhost:${env.port}/api/docs`);
    if (env.aws.enabled) {
      console.log(`File uploads: AWS S3 (${env.aws.bucket}, ${env.aws.region})`);
    } else {
      console.log('File uploads: local storage (uploads/)');
    }
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
