import { makeTestCertificate } from '@notaflow/test-kit';
import { describe, expect, test } from 'vitest';
import { CertificateError, type CertificateErrorCode } from './CertificateError';
import { loadCertificate } from './loadCertificate';

function codeOf(run: () => unknown): CertificateErrorCode | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof CertificateError) return error.code;
    throw error;
  }
  return undefined;
}

describe('loadCertificate', () => {
  test('loads a 3DES .pfx and reads CNPJ, dates, and fingerprint', () => {
    const cert = makeTestCertificate({ cnpj: '12345678000195' });
    const material = loadCertificate(cert.pfx, cert.password);
    expect(material.cnpj).toBe('12345678000195');
    expect(material.subject).toContain('EMPRESA TESTE LTDA:12345678000195');
    expect(material.privateKeyPem).toContain('PRIVATE KEY');
    expect(material.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(material.fingerprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('reads an alphanumeric CNPJ', () => {
    const cert = makeTestCertificate({ cnpj: 'AB345678000195' });
    expect(loadCertificate(cert.pfx, cert.password).cnpj).toBe('AB345678000195');
  });

  test('rejects a wrong password with WRONG_PASSWORD', () => {
    const cert = makeTestCertificate();
    expect(codeOf(() => loadCertificate(cert.pfx, 'wrong'))).toBe('WRONG_PASSWORD');
  });

  test('rejects a file that is not PKCS#12 with INVALID_FILE', () => {
    expect(codeOf(() => loadCertificate(Buffer.from('not a certificate'), 'x'))).toBe('INVALID_FILE');
  });

  test('rejects an expired certificate with EXPIRED', () => {
    const cert = makeTestCertificate({
      notBefore: new Date('2019-01-01T00:00:00Z'),
      notAfter: new Date('2020-01-01T00:00:00Z'),
    });
    expect(codeOf(() => loadCertificate(cert.pfx, cert.password))).toBe('EXPIRED');
  });

  test('rejects a certificate that is not valid yet with NOT_YET_VALID', () => {
    const cert = makeTestCertificate({
      notBefore: new Date('2099-01-01T00:00:00Z'),
      notAfter: new Date('2100-01-01T00:00:00Z'),
    });
    expect(codeOf(() => loadCertificate(cert.pfx, cert.password))).toBe('NOT_YET_VALID');
  });

  test('rejects a CN without a CNPJ with CNPJ_NOT_FOUND', () => {
    const cert = makeTestCertificate({ cnpj: 'short' });
    expect(codeOf(() => loadCertificate(cert.pfx, cert.password))).toBe('CNPJ_NOT_FOUND');
  });
});
