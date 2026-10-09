import { describe, expect, test } from 'vitest';
import { readFixture } from '../../test/fixtures';
import { buildDpsXml } from '../dps/buildDpsXml';
import { readTemplate, TemplateUnsupportedError } from './readTemplate';

const full = readFixture('NFSE_EXPORT_FULL.xml');

describe('readTemplate', () => {
  test('copies every fiscal group of an export invoice', () => {
    expect(readTemplate(full)).toEqual({
      emitterMunicipality: '4113700',
      provider: {
        cnpj: '12345678000195',
        phone: '43999990000',
        email: 'contato@example.com',
        simplesNacional: '3',
        simplesRegime: '1',
        specialRegime: '0',
      },
      customer: {
        document: { type: 'NIF', value: '00-0000000' },
        name: 'Foreign Customer Inc',
        address: {
          country: 'US',
          postalCode: '99999',
          city: 'Testville',
          region: 'NY',
          street: '1 Example Street',
          number: '1',
          complement: 'Suite 2',
          district: 'Downtown',
        },
      },
      service: {
        municipality: '4113700',
        nationalTaxCode: '010701',
        description: 'Serviços de TI para tomador no exterior',
        nbsCode: '115080000',
        foreignTrade: {
          mode: '1',
          providerLink: '0',
          currency: '220',
          amountInCurrencyCents: 200000,
          providerSupport: '02',
          customerSupport: '02',
          temporaryGoods: '1',
          mdic: '0',
        },
      },
      serviceCents: 1086420,
      tax: {
        issqnTaxation: '3',
        resultCountry: 'US',
        issRetention: '1',
        pisCofins: { cst: '00', retention: '0' },
        simplesTotalPercent: '6.00',
      },
      ibsCbs: {
        purpose: '0',
        finalConsumer: '0',
        operationCode: '100302',
        destination: '0',
        cst: '410',
        classCode: '410027',
      },
    });
  });

  test('round trip: the template rebuilds the same infDPS', () => {
    const template = readTemplate(full);
    const { serviceCents, ...rest } = template;
    const { xml } = buildDpsXml({
      ...rest,
      environment: 'producao_restrita',
      issuedAt: new Date('2026-09-02T16:12:54Z'),
      appVersion: 'notaflow-test',
      series: '900',
      number: 6,
      competence: '2026-08-31',
      amounts: { serviceCents },
    });
    expect(full).toContain(xml.replace(/^<DPS xmlns="[^"]+" versao="1\.01">/, ''));
  });

  test('a field the builder does not support is refused with its path', () => {
    const xml = full.replace(
      '<tpRetISSQN>1</tpRetISSQN>',
      '<BM><tpBM>1</tpBM></BM><tpRetISSQN>1</tpRetISSQN>',
    );
    try {
      readTemplate(xml);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateUnsupportedError);
      expect((error as TemplateUnsupportedError).paths).toEqual(['valores/trib/tribMun/BM/tpBM']);
    }
  });

  test('a domestic invoice with a CNPJ customer and ISS rate reads too', () => {
    const domestic = readFixture('NFSE_DOMESTIC.xml');
    const template = readTemplate(domestic);
    expect(template.customer?.document).toEqual({ type: 'CNPJ', value: '98765432000110' });
    expect(template.tax).toEqual({ issqnTaxation: '1', issRetention: '1' });
  });
});
