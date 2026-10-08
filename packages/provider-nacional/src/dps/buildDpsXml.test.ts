import { loadCertificate, NodeSigner } from '@notaflow/signer-node';
import { makeTestCertificate } from '@notaflow/test-kit';
import { describe, expect, test } from 'vitest';
import { validateAgainstXsd } from '../../test/xsd';
import { buildDpsId } from './buildDpsId';
import { buildDpsXml } from './buildDpsXml';
import type { DpsInput } from './types';

const base: DpsInput = {
  environment: 'producao_restrita',
  issuedAt: new Date('2026-10-08T18:00:00Z'),
  appVersion: 'notaflow-0.0.0',
  series: '900',
  number: 1,
  competence: '2026-10-01',
  emitterMunicipality: '3550308',
  provider: {
    cnpj: '12345678000195',
    municipalRegistration: '1234567',
    simplesNacional: '1',
    specialRegime: '0',
  },
  customer: {
    document: { type: 'CNPJ', value: '98765432000110' },
    name: 'Cliente Exemplo Ltda',
    email: 'financeiro@example.com',
    address: {
      municipality: '3550308',
      zip: '01310100',
      street: 'Av. Paulista',
      number: '1000',
      district: 'Bela Vista',
    },
  },
  service: {
    municipality: '3550308',
    nationalTaxCode: '010101',
    description: 'Consultoria em análise & ção <teste>',
    nbsCode: '115022000',
  },
  amounts: { serviceCents: 150000 },
  tax: { issqnTaxation: '1', issRetention: '1' },
};

describe('buildDpsId', () => {
  test('builds the 45-character id', () => {
    const id = buildDpsId({
      municipality: '3550308',
      cnpj: '12345678000195',
      series: '900',
      number: 1,
    });
    expect(id).toBe('DPS355030821234567800019500900000000000000001');
    expect(id).toHaveLength(45);
  });

  test('accepts an alphanumeric CNPJ', () => {
    expect(
      buildDpsId({ municipality: '3550308', cnpj: 'AB345678000195', series: '1', number: 7 }),
    ).toHaveLength(45);
  });

  test('rejects a municipality that is not 7 digits', () => {
    expect(() =>
      buildDpsId({ municipality: '355', cnpj: '12345678000195', series: '1', number: 1 }),
    ).toThrow(RangeError);
  });
});

describe('buildDpsXml', () => {
  test('produces a DPS that validates against DPS_v1.01.xsd', () => {
    const result = validateAgainstXsd(buildDpsXml(base).xml, 'DPS_v1.01.xsd');
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test('validates without the optional customer, address, and NBS', () => {
    const { customer: _customer, ...noCustomer } = base;
    const input: DpsInput = {
      ...noCustomer,
      service: { municipality: '3550308', nationalTaxCode: '010101', description: 'Serviço' },
    };
    expect(validateAgainstXsd(buildDpsXml(input).xml, 'DPS_v1.01.xsd').errors).toEqual([]);
  });

  test('writes the fields the Sefin reads first', () => {
    const { id, xml } = buildDpsXml(base);
    expect(id).toBe(
      buildDpsId({ municipality: '3550308', cnpj: '12345678000195', series: '900', number: 1 }),
    );
    expect(xml).toContain(`<infDPS Id="${id}">`);
    expect(xml).toContain('<tpAmb>2</tpAmb>');
    expect(xml).toContain('<dhEmi>2026-10-08T15:00:00-03:00</dhEmi>');
    expect(xml).toContain('<vServ>1500.00</vServ>');
    expect(xml).toContain('Consultoria em análise &amp; ção &lt;teste&gt;');
  });

  test('uses tpAmb 1 in production', () => {
    expect(buildDpsXml({ ...base, environment: 'producao' }).xml).toContain('<tpAmb>1</tpAmb>');
  });

  test('a signed DPS validates against the XSD', async () => {
    const testCert = makeTestCertificate();
    const certificate = loadCertificate(testCert.pfx, testCert.password);
    const signed = await new NodeSigner().sign({
      xml: buildDpsXml(base).xml,
      elementName: 'infDPS',
      certificate,
      profile: 'rsa-sha1-c14n',
    });
    expect(validateAgainstXsd(signed, 'DPS_v1.01.xsd').errors).toEqual([]);
  });
});

test('the XSD check rejects a DPS with elements out of order', () => {
  const { xml } = buildDpsXml(base);
  const swapped = xml.replace(/(<tpAmb>.*?<\/tpAmb>)(<dhEmi>.*?<\/dhEmi>)/, '$2$1');
  const result = validateAgainstXsd(swapped, 'DPS_v1.01.xsd');
  expect(result.valid).toBe(false);
  expect(result.errors.join(' ')).toContain('dhEmi');
});
