import type { AccountContext } from '../domain/Tenancy';
import type { CertificateMaterial } from './Signer';

export interface CertificateStore {
  loadActive(context: AccountContext, emitterId: string): Promise<CertificateMaterial | null>;
}
