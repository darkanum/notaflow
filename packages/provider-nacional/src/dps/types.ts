export type Environment = 'producao' | 'producao_restrita';

export interface Address {
  municipality: string; // IBGE, 7 digits
  zip: string; // 8 digits
  street: string;
  number: string;
  complement?: string;
  district: string;
}

export interface DpsInput {
  environment: Environment;
  issuedAt: Date;
  appVersion: string;
  series: string;
  number: number;
  competence: string; // YYYY-MM-DD
  emitterMunicipality: string;
  provider: {
    cnpj: string;
    municipalRegistration?: string;
    phone?: string;
    email?: string;
    simplesNacional: '1' | '2' | '3';
    simplesRegime?: '1' | '2' | '3';
    specialRegime: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '9';
  };
  customer?: {
    document: { type: 'CNPJ' | 'CPF'; value: string };
    municipalRegistration?: string;
    name: string;
    address?: Address;
    phone?: string;
    email?: string;
  };
  service: {
    municipality: string;
    nationalTaxCode: string; // cTribNac, 6 digits
    municipalTaxCode?: string; // cTribMun, 3 digits
    description: string;
    nbsCode?: string; // 9 digits
  };
  amounts: { serviceCents: number };
  tax: {
    issqnTaxation: '1' | '2' | '3' | '4';
    issRetention: '1' | '2' | '3';
    issRatePercent?: string; // e.g. "2.00"
  };
}
