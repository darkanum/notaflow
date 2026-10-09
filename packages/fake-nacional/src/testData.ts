import type { DpsInput } from '@notaflow/provider-nacional';

export const dpsInput: DpsInput = {
  environment: 'producao_restrita',
  issuedAt: new Date('2026-10-08T18:00:00Z'),
  appVersion: 'notaflow-test',
  series: '900',
  number: 1,
  competence: '2026-10-01',
  emitterMunicipality: '3550308',
  provider: { cnpj: '12345678000195', simplesNacional: '1', specialRegime: '0' },
  customer: { document: { type: 'CNPJ', value: '98765432000110' }, name: 'Cliente Exemplo Ltda' },
  service: {
    municipality: '3550308',
    nationalTaxCode: '010101',
    description: 'Consultoria em análise & ção <teste>',
  },
  amounts: { serviceCents: 150000 },
  tax: { issqnTaxation: '1', issRetention: '1' },
};
