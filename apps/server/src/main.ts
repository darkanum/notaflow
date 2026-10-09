import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db/openDatabase';
import { SyncTargetRepository } from './repos/SyncTargetRepository';
import { runAllOnce, startScheduler } from './sync/scheduler';

const SYNC_INTERVAL_MS = 30 * 60_000;

try {
  const config = loadConfig(process.env);
  const { db } = openDatabase(config.databasePath);
  const app = buildApp({ config, db });
  await app.listen({ host: config.host, port: config.port });
  const targets = new SyncTargetRepository(db);
  startScheduler(
    () =>
      runAllOnce({
        targets,
        sync: app.syncService,
        log: (message, data) => app.log.info(data, message),
      }),
    SYNC_INTERVAL_MS,
  );
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
