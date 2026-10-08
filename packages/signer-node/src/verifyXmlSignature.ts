import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import * as xpath from 'xpath';

const SIGNATURE =
  "//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']";

export function verifyXmlSignature(signedXml: string, certificatePem: string): boolean {
  const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
  const node = xpath.select1(SIGNATURE, doc as unknown as Node);
  if (!node || !xpath.isNodeLike(node)) return false;
  const verifier = new SignedXml({ publicCert: certificatePem });
  verifier.loadSignature(node.toString());
  try {
    return verifier.checkSignature(signedXml);
  } catch {
    return false;
  }
}
