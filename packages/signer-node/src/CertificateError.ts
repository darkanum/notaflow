export type CertificateErrorCode =
  | 'INVALID_FILE'
  | 'WRONG_PASSWORD'
  | 'NO_PRIVATE_KEY'
  | 'NO_MATCHING_CERTIFICATE'
  | 'CNPJ_NOT_FOUND'
  | 'NOT_YET_VALID'
  | 'EXPIRED';

export class CertificateError extends Error {
  constructor(
    readonly code: CertificateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CertificateError';
  }
}
