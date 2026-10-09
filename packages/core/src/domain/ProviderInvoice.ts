export type Environment = 'producao' | 'producao_restrita';

export interface PartyDocument {
  type: 'CNPJ' | 'CPF' | 'NIF';
  value: string;
}

export interface DomesticAddress {
  kind: 'domestic';
  municipality: string; // IBGE, 7 digits
  zip: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
}

export interface ForeignPartyAddress {
  kind: 'foreign';
  country: string; // ISO 3166-1 alpha-2
  postalCode: string;
  city: string;
  region: string;
  street: string;
  number: string;
  complement?: string;
  district: string;
}

export type PartyAddress = DomesticAddress | ForeignPartyAddress;

export interface InvoiceParty {
  // null when the invoice says the customer has no document (cNaoNIF).
  document: PartyDocument | null;
  name: string;
  municipalRegistration?: string;
  address?: PartyAddress;
  email?: string;
  phone?: string;
}

// An invoice as the provider reports it. The XML is the source of truth; the rest is a projection.
export interface ProviderInvoice {
  accessKey: string;
  number: string;
  environment: Environment;
  issuedAt: Date;
  competence: string; // YYYY-MM-DD
  dps: { id: string; series: string; number: number };
  provider: { cnpj: string; name: string };
  customer: InvoiceParty | null;
  service: { nationalTaxCode: string; description: string; nbsCode?: string };
  amounts: { serviceCents: number; issCents?: number; netCents: number };
  xml: string;
}

export interface ProviderEvent {
  accessKey: string;
  code: string; // 101101 = cancellation
  registeredAt: Date;
  reasonCode?: string;
  justification?: string;
  xml: string;
}
