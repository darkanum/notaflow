import { describe, expect, test } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { NfseParseError } from '../xml/readXml';
import { parseNfseXml } from './parseNfseXml';

describe('parseNfseXml', () => {
  test('reads a domestic invoice', () => {
    const xml = readFixture('NFSE_DOMESTIC.xml');
    expect(parseNfseXml(xml)).toEqual({
      accessKey: '35503082212345678000195000000000004226100000000420',
      number: '42',
      environment: 'producao_restrita',
      issuedAt: new Date('2026-10-01T13:00:00Z'),
      competence: '2026-09-30',
      dps: { id: 'DPS355030821234567800019500900000000000000042', series: '900', number: 42 },
      provider: { cnpj: '12345678000195', name: 'EMPRESA TESTE LTDA' },
      customer: {
        document: { type: 'CNPJ', value: '98765432000110' },
        name: 'Cliente Exemplo & Filhos Ltda',
        municipalRegistration: '7654321',
        address: {
          kind: 'domestic',
          municipality: '3550308',
          zip: '01310100',
          street: 'Av. Paulista',
          number: '1000',
          complement: 'Sala 1',
          district: 'Bela Vista',
        },
        email: 'financeiro@example.com',
        phone: '11999990000',
      },
      service: {
        nationalTaxCode: '010101',
        description: 'Consultoria em análise & ção <teste>',
        nbsCode: '115022000',
      },
      amounts: { serviceCents: 150000, issCents: 3000, netCents: 147000 },
      xml,
    });
  });

  test('reads an export invoice with a foreign customer and no ISS', () => {
    const invoice = parseNfseXml(readFixture('NFSE_EXPORT.xml'));
    expect(invoice.environment).toBe('producao');
    expect(invoice.customer).toEqual({
      document: { type: 'NIF', value: '00-0000000' },
      name: 'Foreign Customer Inc',
      address: {
        kind: 'foreign',
        country: 'US',
        postalCode: '99999',
        city: 'Testville',
        region: 'NY',
        street: '1 Example Street',
        number: '1',
        district: 'Downtown',
      },
    });
    expect(invoice.amounts).toEqual({ serviceCents: 100000, netCents: 100000 });
  });

  test('a customer with cNaoNIF has a null document', () => {
    const xml = readFixture('NFSE_EXPORT.xml').replace(
      '<NIF>00-0000000</NIF>',
      '<cNaoNIF>1</cNaoNIF>',
    );
    expect(parseNfseXml(xml).customer?.document).toBeNull();
  });

  test('an invoice without a toma group has a null customer', () => {
    const xml = readFixture('NFSE_DOMESTIC.xml').replace(/<toma>.*<\/toma>/, '');
    expect(parseNfseXml(xml).customer).toBeNull();
  });

  test('throws NfseParseError for XML that is not an NFS-e', () => {
    expect(() => parseNfseXml('<other/>')).toThrow(NfseParseError);
    expect(() => parseNfseXml('not xml at all <')).toThrow(NfseParseError);
  });

  test('throws NfseParseError when a required field is missing', () => {
    const xml = readFixture('NFSE_DOMESTIC.xml').replace('<nNFSe>42</nNFSe>', '');
    expect(() => parseNfseXml(xml)).toThrow(/nNFSe/);
  });
});
