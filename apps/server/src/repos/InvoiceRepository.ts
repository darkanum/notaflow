import { randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { AccountContext, Environment, ProviderEvent, ProviderInvoice } from '@notaflow/core';
import { and, asc, count, desc, eq, gte, like, lte, or, type SQL } from 'drizzle-orm';
import type { Database } from '../db/openDatabase';
import { emitters, invoiceEvents, invoices } from '../db/schema';

export type InvoiceStatus = (typeof invoices.$inferSelect)['status'];
export const CANCELLATION = '101101';

export interface InvoiceFilter {
  emitterId?: string;
  environment?: Environment;
  status?: InvoiceStatus;
  competenceFrom?: string;
  competenceTo?: string;
  search?: string;
  limit: number;
  offset: number;
}

const summary = {
  id: invoices.id,
  emitterId: invoices.emitterId,
  accessKey: invoices.accessKey,
  number: invoices.number,
  status: invoices.status,
  environment: invoices.environment,
  issuedAt: invoices.issuedAt,
  competence: invoices.competence,
  customerDocument: invoices.customerDocument,
  customerName: invoices.customerName,
  serviceCode: invoices.serviceCode,
  description: invoices.description,
  serviceCents: invoices.serviceCents,
  issCents: invoices.issCents,
  netCents: invoices.netCents,
  origin: invoices.origin,
};

export class InvoiceRepository {
  constructor(private readonly db: Database) {}

  upsertSynced(
    ctx: AccountContext,
    emitterId: string,
    invoice: ProviderInvoice,
    customerId: string | null,
  ): { id: string; created: boolean } {
    this.requireEmitter(ctx, emitterId);
    const cancelled = this.db
      .select({ id: invoiceEvents.id })
      .from(invoiceEvents)
      .where(
        and(eq(invoiceEvents.accessKey, invoice.accessKey), eq(invoiceEvents.code, CANCELLATION)),
      )
      .get();
    const projection = {
      customerId,
      number: invoice.number,
      dpsId: invoice.dps.id,
      dpsSeries: invoice.dps.series,
      dpsNumber: invoice.dps.number,
      environment: invoice.environment,
      issuedAt: invoice.issuedAt,
      competence: invoice.competence,
      customerDocument: invoice.customer?.document?.value ?? null,
      customerName: invoice.customer?.name ?? null,
      serviceCode: invoice.service.nationalTaxCode,
      description: invoice.service.description,
      serviceCents: invoice.amounts.serviceCents,
      issCents: invoice.amounts.issCents ?? null,
      netCents: invoice.amounts.netCents,
      xmlGzip: gzipSync(invoice.xml),
      updatedAt: new Date(),
    };
    const existing = this.db
      .select()
      .from(invoices)
      .where(eq(invoices.accessKey, invoice.accessKey))
      .get();
    if (existing) {
      const status = existing.status === 'cancelled' || cancelled ? 'cancelled' : existing.status;
      this.db
        .update(invoices)
        .set({ ...projection, status })
        .where(eq(invoices.id, existing.id))
        .run();
      return { id: existing.id, created: false };
    }
    const id = randomUUID();
    this.db
      .insert(invoices)
      .values({
        ...projection,
        id,
        emitterId,
        accessKey: invoice.accessKey,
        status: cancelled ? 'cancelled' : 'issued',
        origin: 'synced',
      })
      .run();
    this.db
      .update(invoiceEvents)
      .set({ invoiceId: id })
      .where(eq(invoiceEvents.accessKey, invoice.accessKey))
      .run();
    return { id, created: true };
  }

  recordEvent(ctx: AccountContext, emitterId: string, event: ProviderEvent): boolean {
    this.requireEmitter(ctx, emitterId);
    const invoice = this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.accessKey, event.accessKey), eq(invoices.emitterId, emitterId)))
      .get();
    const inserted = this.db
      .insert(invoiceEvents)
      .values({
        id: randomUUID(),
        emitterId,
        invoiceId: invoice?.id ?? null,
        accessKey: event.accessKey,
        code: event.code,
        reasonCode: event.reasonCode ?? null,
        justification: event.justification ?? null,
        registeredAt: event.registeredAt,
        xmlGzip: gzipSync(event.xml),
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) return false;
    if (invoice && event.code === CANCELLATION) {
      this.db
        .update(invoices)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(invoices.id, invoice.id))
        .run();
    }
    return true;
  }

  list(ctx: AccountContext, filter: InvoiceFilter) {
    const conditions: SQL[] = [eq(emitters.accountId, ctx.accountId)];
    if (filter.emitterId) conditions.push(eq(invoices.emitterId, filter.emitterId));
    if (filter.environment) conditions.push(eq(invoices.environment, filter.environment));
    if (filter.status) conditions.push(eq(invoices.status, filter.status));
    if (filter.competenceFrom) conditions.push(gte(invoices.competence, filter.competenceFrom));
    if (filter.competenceTo) conditions.push(lte(invoices.competence, filter.competenceTo));
    if (filter.search) {
      const pattern = `%${filter.search}%`;
      const match = or(
        like(invoices.number, pattern),
        like(invoices.customerName, pattern),
        like(invoices.customerDocument, pattern),
      );
      if (match) conditions.push(match);
    }
    const where = and(...conditions);
    const total =
      this.db
        .select({ value: count() })
        .from(invoices)
        .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
        .where(where)
        .get()?.value ?? 0;
    const items = this.db
      .select(summary)
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(where)
      .orderBy(desc(invoices.competence), desc(invoices.issuedAt))
      .limit(filter.limit)
      .offset(filter.offset)
      .all();
    return { items, total };
  }

  get(ctx: AccountContext, invoiceId: string) {
    const row = this.db
      .select(summary)
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.id, invoiceId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!row) return null;
    const events = this.db
      .select({
        code: invoiceEvents.code,
        reasonCode: invoiceEvents.reasonCode,
        justification: invoiceEvents.justification,
        registeredAt: invoiceEvents.registeredAt,
      })
      .from(invoiceEvents)
      .where(eq(invoiceEvents.accessKey, row.accessKey ?? ''))
      .orderBy(asc(invoiceEvents.registeredAt))
      .all();
    return { ...row, events };
  }

  findIdByAccessKey(ctx: AccountContext, accessKey: string): string | null {
    const row = this.db
      .select({ id: invoices.id })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.accessKey, accessKey), eq(emitters.accountId, ctx.accountId)))
      .get();
    return row?.id ?? null;
  }

  xml(ctx: AccountContext, invoiceId: string): string | null {
    const row = this.db
      .select({ xmlGzip: invoices.xmlGzip })
      .from(invoices)
      .innerJoin(emitters, eq(emitters.id, invoices.emitterId))
      .where(and(eq(invoices.id, invoiceId), eq(emitters.accountId, ctx.accountId)))
      .get();
    return row?.xmlGzip ? gunzipSync(row.xmlGzip).toString('utf8') : null;
  }

  private requireEmitter(ctx: AccountContext, emitterId: string): void {
    const emitter = this.db
      .select({ id: emitters.id })
      .from(emitters)
      .where(and(eq(emitters.id, emitterId), eq(emitters.accountId, ctx.accountId)))
      .get();
    if (!emitter) throw new Error('Emitter not found in this account.');
  }
}

export type InvoiceSummary = ReturnType<InvoiceRepository['list']>['items'][number];
export type InvoiceDetail = NonNullable<ReturnType<InvoiceRepository['get']>>;
