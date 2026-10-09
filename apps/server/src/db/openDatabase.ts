import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Database = BetterSQLite3Database<typeof schema> & {
  $client: BetterSqlite3.Database;
};

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function openDatabase(path: string): { db: Database; close(): void } {
  const client = new BetterSqlite3(path);
  client.pragma('journal_mode = WAL');
  // SQLite leaves foreign keys off unless every connection turns them on.
  client.pragma('foreign_keys = ON');
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
