import { randomUUID } from 'node:crypto';
import type { AccountContext, AccountRole, AdminContext } from '@notaflow/core';
import { eq } from 'drizzle-orm';
import type { Database } from '../src/db/openDatabase';
import { accounts, memberships, users } from '../src/db/schema';

export function seedUser(
  db: Database,
  email: string,
  platformRole: 'admin' | 'user' = 'user',
): string {
  const id = randomUUID();
  db.insert(users)
    .values({ id, email: email.toLowerCase(), name: email.split('@')[0] ?? email, platformRole })
    .run();
  return id;
}

export function seedTenant(
  db: Database,
  input: {
    accountName: string;
    email: string;
    role?: AccountRole;
    status?: 'active' | 'suspended';
  },
): AccountContext {
  const accountId = randomUUID();
  db.insert(accounts)
    .values({ id: accountId, name: input.accountName, status: input.status ?? 'active' })
    .run();
  const existing = db.select().from(users).where(eq(users.email, input.email.toLowerCase())).get();
  const userId = existing?.id ?? seedUser(db, input.email);
  const role = input.role ?? 'owner';
  db.insert(memberships).values({ id: randomUUID(), userId, accountId, role }).run();
  return { accountId, userId, role, accountStatus: input.status ?? 'active' };
}

export function adminOf(userId: string): AdminContext {
  return { userId, admin: true };
}
