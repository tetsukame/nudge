import 'dotenv/config';
import pg from 'pg';
import { runScheduler } from './scheduler';
import { runSender } from './sender';

const TICK_INTERVAL_MS = 60_000;

let stopRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(adminPool: pg.Pool): Promise<void> {
  try {
    await runScheduler(adminPool);
  } catch (err) {
    console.error('[worker] scheduler error:', (err as Error).message);
  }
  try {
    await runSender(adminPool);
  } catch (err) {
    console.error('[worker] sender error:', (err as Error).message);
  }
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) {
    console.error('DATABASE_URL_ADMIN is required');
    process.exit(1);
  }
  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 5 });

  process.on('SIGTERM', () => {
    stopRequested = true;
  });
  process.on('SIGINT', () => {
    stopRequested = true;
  });

  console.log('[worker] started, tick interval =', TICK_INTERVAL_MS, 'ms');
  while (!stopRequested) {
    const start = Date.now();
    await tick(adminPool);
    if (stopRequested) break;
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, TICK_INTERVAL_MS - elapsed);
    await sleep(remaining);
  }
  console.log('[worker] shutting down...');
  await adminPool.end();
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
