import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db/openDatabase';

try {
  const config = loadConfig(process.env);
  const { db } = openDatabase(config.databasePath);
  const app = buildApp({ config, db });
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
