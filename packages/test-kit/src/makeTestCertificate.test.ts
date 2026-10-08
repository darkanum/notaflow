import forge from 'node-forge';
import { expect, test } from 'vitest';
import { makeTestCertificate } from './makeTestCertificate';

const CERT_BAG = '1.2.840.113549.1.12.10.1.3';

test('creates a 3DES PKCS#12 that opens with the password and carries the CNPJ in the CN', () => {
  const cert = makeTestCertificate({ cnpj: 'AB345678000195' });
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(cert.pfx.toString('binary')));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, cert.password);
  const bags = p12.getBags({ bagType: CERT_BAG })[CERT_BAG] ?? [];
  const cn = bags[0]?.cert?.subject.getField('CN')?.value;
  expect(cn).toBe('EMPRESA TESTE LTDA:AB345678000195');
});

test('respects custom validity dates', () => {
  const notAfter = new Date('2020-01-01T00:00:00Z');
  const cert = makeTestCertificate({ notBefore: new Date('2019-01-01T00:00:00Z'), notAfter });
  expect(forge.pki.certificateFromPem(cert.certificatePem).validity.notAfter).toEqual(notAfter);
});
