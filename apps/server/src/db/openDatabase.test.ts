import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openDatabase } from './openDatabase';
import { accounts, emitters, users } from './schema';

test('applies the migrations to a new database', () => {
  const { db, close } = openDatabase(':memory:');
  const tables = db.$client
    .prepare("select name from sqlite_master where type = 'table'")
    .all() as { name: string }[];
  expect(tables.map((t) => t.name)).toEqual(
    expect.arrayContaining([
      'accounts',
      'audit_log',
      'certificates',
      'emitters',
      'memberships',
      'users',
    ]),
  );
  close();
});

test('a CNPJ belongs to one emitter on the whole platform', () => {
  const { db, close } = openDatabase(':memory:');
  const a = randomUUID();
  const b = randomUUID();
  db.insert(accounts)
    .values([
      { id: a, name: 'A' },
      { id: b, name: 'B' },
    ])
    .run();
  const emitter = {
    cnpj: '12345678000195',
    companyName: 'EMPRESA TESTE LTDA',
    municipality: '3550308',
    simplesNacional: '1' as const,
    specialRegime: '0',
    dpsSeries: '900',
  };
  db.insert(emitters)
    .values({ id: randomUUID(), accountId: a, ...emitter })
    .run();
  expect(() =>
    db
      .insert(emitters)
      .values({ id: randomUUID(), accountId: b, ...emitter })
      .run(),
  ).toThrow(/UNIQUE/);
  close();
});

test('an email belongs to one user', () => {
  const { db, close } = openDatabase(':memory:');
  db.insert(users).values({ id: randomUUID(), email: 'a@example.com', name: 'A' }).run();
  expect(() =>
    db.insert(users).values({ id: randomUUID(), email: 'a@example.com', name: 'B' }).run(),
  ).toThrow(/UNIQUE/);
  close();
});

test('foreign keys are enforced', () => {
  const { db, close } = openDatabase(':memory:');
  expect(() =>
    db
      .insert(emitters)
      .values({
        id: randomUUID(),
        accountId: 'missing',
        cnpj: '12345678000195',
        companyName: 'X',
        municipality: '3550308',
        simplesNacional: '1',
        specialRegime: '0',
        dpsSeries: '900',
      })
      .run(),
  ).toThrow(/FOREIGN KEY/);
  close();
});

test('creates the parent folder of a database file that does not exist yet', () => {
  const root = mkdtempSync(join(tmpdir(), 'notaflow-db-'));
  const path = join(root, 'data', 'nested', 'notaflow.db');
  const { close } = openDatabase(path);
  close();
  expect(existsSync(path)).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

test('the invoice migration adds the sync tables', () => {
  const { db, close } = openDatabase(':memory:');
  const tables = (
    db.$client.prepare("select name from sqlite_master where type = 'table'").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
  expect(tables).toEqual(
    expect.arrayContaining(['customers', 'invoices', 'invoice_events', 'sync_state']),
  );
  close();
});
