import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { runScheduler } from './scheduler';
import { runSender } from './sender';
import { runRetention } from './retention';
import { logger, runWithLogContext } from '@/lib/logger';

const TICK_INTERVAL_MS = 60_000;

let stopRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(adminPool: pg.Pool): Promise<void> {
  await runWithLogContext({ runId: randomUUID() }, async () => {
    try {
      await runScheduler(adminPool);
    } catch (err) {
      logger.error({ err, job: 'scheduler' }, 'worker job failed');
    }
    try {
      await runSender(adminPool);
    } catch (err) {
      logger.error({ err, job: 'sender' }, 'worker job failed');
    }
    try {
      await runRetention(adminPool);
    } catch (err) {
      logger.error({ err, job: 'retention' }, 'worker job failed');
    }
  });
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) {
    logger.fatal('DATABASE_URL_ADMIN is required');
    process.exit(1);
  }
  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 5 });

  process.on('SIGTERM', () => {
    stopRequested = true;
  });
  process.on('SIGINT', () => {
    stopRequested = true;
  });

  logger.info({ tickIntervalMs: TICK_INTERVAL_MS }, 'worker started');
  while (!stopRequested) {
    const start = Date.now();
    await tick(adminPool);
    if (stopRequested) break;
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, TICK_INTERVAL_MS - elapsed);
    await sleep(remaining);
  }
  logger.info('worker shutting down');
  await adminPool.end();
}

main().catch((err) => {
  logger.fatal({ err }, 'worker fatal');
  process.exit(1);
});
