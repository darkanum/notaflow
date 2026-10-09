import type { AccountContext, CertificateMaterial, CertificateStore } from '@notaflow/core';
import { loadCertificate } from '@notaflow/signer-node';
import type { CertificateRepository } from '../repos/CertificateRepository';
import { openCertificate } from './envelope';

export class VaultCertificateStore implements CertificateStore {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly masterKey: Buffer,
  ) {}

  async loadActive(
    context: AccountContext,
    emitterId: string,
  ): Promise<CertificateMaterial | null> {
    const row = this.certificates.activeFor(context, emitterId);
    if (!row) return null;
    const { pfx, password } = openCertificate(row, this.masterKey);
    return loadCertificate(pfx, password);
  }
}
