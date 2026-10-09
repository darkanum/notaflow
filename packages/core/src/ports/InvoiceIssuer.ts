import type { InvoiceParty, ProviderEvent, ProviderInvoice } from '../domain/ProviderInvoice';

export interface IssueRequest {
  templateXml: string; // the stored NFS-e the new invoice copies
  series: string;
  number: number;
  issuedAt: Date;
  competence: string; // YYYY-MM-DD
  serviceCents: number;
  foreignAmountCents?: number; // export invoices only
  description?: string;
  customer?: InvoiceParty; // replaces the template's customer
}

export type IssueOutcome =
  | { kind: 'issued'; invoice: ProviderInvoice }
  | { kind: 'rejected'; errors: { code: string; message: string }[] }
  | { kind: 'uncertain'; reason: string };

export type CancelOutcome =
  | { kind: 'cancelled'; event: ProviderEvent | null }
  | { kind: 'rejected'; error: { code: string; message: string } };

export interface InvoiceIssuer {
  dpsId(series: string, number: number, templateXml: string): string;
  issue(request: IssueRequest): Promise<IssueOutcome>;
  findIssued(dpsId: string): Promise<ProviderInvoice | null>;
  cancel(accessKey: string, reason: '1' | '2' | '9', justification: string): Promise<CancelOutcome>;
}
