export type SignatureProfile = 'rsa-sha1-c14n' | 'rsa-sha256-exc-c14n';

export interface CertificateMaterial {
  privateKeyPem: string;
  certificatePem: string;
  cnpj: string;
  subject: string;
  notBefore: Date;
  notAfter: Date;
  fingerprintSha256: string;
}

export interface SignRequest {
  xml: string;
  // Local name of the element that carries the Id; the Signature goes right after it.
  elementName: string;
  certificate: CertificateMaterial;
  profile: SignatureProfile;
}

export interface Signer {
  sign(request: SignRequest): Promise<string>;
}
