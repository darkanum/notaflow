import type { CertificateMaterial } from '@notaflow/core';
import { Agent, type Dispatcher } from 'undici';

// PEM instead of the raw .pfx: OpenSSL 3 refuses the legacy RC2 encryption many e-CNPJ files use.
export function createMtlsDispatcher(certificate: CertificateMaterial): Dispatcher {
  return new Agent({
    connect: { key: certificate.privateKeyPem, cert: certificate.certificatePem, minVersion: 'TLSv1.2' },
  });
}
