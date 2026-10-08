import type { SignatureProfile, Signer, SignRequest } from '@notaflow/core';
import { SignedXml } from 'xml-crypto';

const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const PROFILES: Record<SignatureProfile, { signature: string; digest: string; c14n: string }> = {
  'rsa-sha1-c14n': {
    signature: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    digest: 'http://www.w3.org/2000/09/xmldsig#sha1',
    c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  },
  'rsa-sha256-exc-c14n': {
    signature: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    digest: 'http://www.w3.org/2001/04/xmlenc#sha256',
    c14n: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  },
};

const XML_NAME = /^[A-Za-z_][\w.-]*$/;

export class NodeSigner implements Signer {
  async sign({ xml, elementName, certificate, profile }: SignRequest): Promise<string> {
    if (!XML_NAME.test(elementName)) throw new Error(`Invalid element name: ${elementName}`);
    const algorithms = PROFILES[profile];
    const target = `//*[local-name(.)='${elementName}']`;

    const signature = new SignedXml({
      privateKey: certificate.privateKeyPem,
      publicCert: certificate.certificatePem,
      signatureAlgorithm: algorithms.signature,
      canonicalizationAlgorithm: algorithms.c14n,
    });
    signature.addReference({
      xpath: target,
      digestAlgorithm: algorithms.digest,
      transforms: [ENVELOPED, algorithms.c14n],
    });
    signature.computeSignature(xml, { location: { reference: target, action: 'after' } });
    return signature.getSignedXml();
  }
}
