import { asc } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  userEmail: string;
  accountId: string | null;
  action: string;
  entity: string;
  result: 'ok' | 'refused' | 'error';
  detail?: string;
}

// Append-only and written by the platform itself, so it takes no account context.
export class AuditLog {
  constructor(private readonly db: Database) {}

  record(entry: AuditEntry): void {
    this.db
      .insert(auditLog)
      .values({ ...entry, detail: entry.detail ?? null })
      .run();
  }

  list() {
    return this.db.select().from(auditLog).orderBy(asc(auditLog.id)).all();
  }
}
