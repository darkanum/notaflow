import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

const NAME = /^notaflow-\d{8}-\d{6}\.db$/;

function stamp(now: Date): string {
  const iso = now.toISOString(); // 2026-10-09T06:00:00.000Z
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

// SQLite's online backup copies a consistent snapshot while the app keeps writing.
export async function backupDatabase(
  sourcePath: string,
  dir: string,
  now: Date,
  keep = 14,
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `notaflow-${stamp(now)}.db`);
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
  const old = readdirSync(dir)
    .filter((name) => NAME.test(name))
    .sort()
    .slice(0, -keep);
  for (const name of old) rmSync(join(dir, name));
  return target;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const source = process.env.DATABASE_PATH;
  if (!source) {
    console.error('DATABASE_PATH is required.');
    process.exit(1);
  }
  const path = await backupDatabase(source, join(dirname(source), 'backups'), new Date());
  console.log(`Backup written: ${path}`);
}
