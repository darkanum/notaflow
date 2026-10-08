import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';

export interface TestCertificateOptions {
  cnpj?: string;
  companyName?: string;
  password?: string;
  notBefore?: Date;
  notAfter?: Date;
}

export interface TestCertificate {
  pfx: Buffer;
  password: string;
  cnpj: string;
  privateKeyPem: string;
  certificatePem: string;
}

const DAY_MS = 86_400_000;

export function makeTestCertificate(options: TestCertificateOptions = {}): TestCertificate {
  const cnpj = options.cnpj ?? '12345678000195';
  const companyName = options.companyName ?? 'EMPRESA TESTE LTDA';
  const password = options.password ?? 'test-password';

  // node:crypto is much faster than forge's pure-JS RSA key generation.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const forgeKey = forge.pki.privateKeyFromPem(privateKeyPem);

  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(forgeKey.n, forgeKey.e);
  cert.serialNumber = '01';
  cert.validity.notBefore = options.notBefore ?? new Date(Date.now() - DAY_MS);
  cert.validity.notAfter = options.notAfter ?? new Date(Date.now() + 365 * DAY_MS);
  const attributes = [
    { name: 'commonName', value: `${companyName}:${cnpj}` },
    { name: 'organizationName', value: 'ICP-Brasil' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attributes);
  cert.setIssuer(attributes);
  cert.setExtensions([
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true },
  ]);
  cert.sign(forgeKey, forge.md.sha256.create());

  // 3DES matches what most e-CNPJ issuers ship.
  const p12 = forge.pkcs12.toPkcs12Asn1(forgeKey, [cert], password, { algorithm: '3des' });
  const pfx = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');

  return { pfx, password, cnpj, privateKeyPem, certificatePem: forge.pki.certificateToPem(cert) };
}
