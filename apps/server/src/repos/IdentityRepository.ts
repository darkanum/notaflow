import type { AccountRole } from '@notaflow/core';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { accounts, memberships, users } from '../db/schema';

export interface Identity {
  userId: string;
  email: string;
  name: string;
  platformRole: 'admin' | 'user';
  memberships: {
    accountId: string;
    accountName: string;
    role: AccountRole;
    accountStatus: 'active' | 'suspended';
  }[];
}

// Authentication runs before any account context exists, so this lookup is not account-scoped.
export class IdentityRepository {
  constructor(private readonly db: Database) {}

  findByEmail(email: string): Identity | null {
    const user = this.db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
    if (!user) return null;
    const rows = this.db
      .select({
        accountId: accounts.id,
        accountName: accounts.name,
        role: memberships.role,
        accountStatus: accounts.status,
      })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.accountId))
      .where(eq(memberships.userId, user.id))
      .all();
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      memberships: rows,
    };
  }

  touchLogin(userId: string): void {
    this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId)).run();
  }
}
