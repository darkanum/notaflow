import type { InvoiceParty, ProviderEvent, ProviderInvoice } from '@notaflow/core';

export const KEY = '35503082212345678000195000000000004226100000000420';

export function providerInvoice(overrides: Partial<ProviderInvoice> = {}): ProviderInvoice {
  const customer: InvoiceParty = {
    document: { type: 'CNPJ', value: '98765432000110' },
    name: 'Cliente Exemplo Ltda',
    email: 'financeiro@example.com',
  };
  return {
    accessKey: KEY,
    number: '42',
    environment: 'producao_restrita',
    issuedAt: new Date('2026-10-01T13:00:00Z'),
    competence: '2026-09-30',
    dps: { id: 'DPS355030821234567800019500900000000000000042', series: '900', number: 42 },
    provider: { cnpj: '12345678000195', name: 'EMPRESA TESTE LTDA' },
    customer,
    service: { nationalTaxCode: '010101', description: 'Consultoria em análise' },
    amounts: { serviceCents: 150000, issCents: 3000, netCents: 147000 },
    xml: '<NFSe>synthetic</NFSe>',
    ...overrides,
  };
}

export function providerEvent(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    accessKey: KEY,
    code: '101101',
    registeredAt: new Date('2026-10-03T21:28:43Z'),
    reasonCode: '1',
    justification: 'Erro no valor do serviço',
    xml: '<evento>synthetic</evento>',
    ...overrides,
  };
}
