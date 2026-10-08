import type { SignatureProfile } from '@notaflow/core';
import { makeTestCertificate } from '@notaflow/test-kit';
import { describe, expect, test } from 'vitest';
import { loadCertificate } from './loadCertificate';
import { NodeSigner } from './NodeSigner';
import { verifyXmlSignature } from './verifyXmlSignature';

const NS = 'http://www.sped.fazenda.gov.br/nfse';
const ID = 'DPS355030821234567800019500900000000000000001';
const xml = `<DPS xmlns="${NS}" versao="1.01"><infDPS Id="${ID}"><xDescServ>Consultoria em análise &amp; ção &lt;teste&gt;</xDescServ></infDPS></DPS>`;

const testCert = makeTestCertificate();
const certificate = loadCertificate(testCert.pfx, testCert.password);
const signer = new NodeSigner();

describe.each<SignatureProfile>(['rsa-sha1-c14n', 'rsa-sha256-exc-c14n'])('NodeSigner %s', (profile) => {
  test('signs infDPS and the signature verifies', async () => {
    const signed = await signer.sign({ xml, elementName: 'infDPS', certificate, profile });
    expect(verifyXmlSignature(signed, certificate.certificatePem)).toBe(true);
  });

  test('places Signature as the last child of DPS, referencing the Id', async () => {
    const signed = await signer.sign({ xml, elementName: 'infDPS', certificate, profile });
    expect(signed).toContain(`<Reference URI="#${ID}"`);
    expect(signed).toMatch(
      /<\/infDPS><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">[\s\S]*<\/Signature><\/DPS>$/,
    );
    expect(signed).toContain('<X509Certificate>');
  });

  test('keeps accented text intact', async () => {
    const signed = await signer.sign({ xml, elementName: 'infDPS', certificate, profile });
    expect(signed).toContain('análise &amp; ção &lt;teste&gt;');
  });

  test('a tampered document fails verification', async () => {
    const signed = await signer.sign({ xml, elementName: 'infDPS', certificate, profile });
    expect(verifyXmlSignature(signed.replace('Consultoria', 'Consultorio'), certificate.certificatePem)).toBe(false);
  });
});

test('rejects an element name that is not a plain XML name', async () => {
  await expect(
    signer.sign({ xml, elementName: "infDPS']|//*['", certificate, profile: 'rsa-sha1-c14n' }),
  ).rejects.toThrow('Invalid element name');
});
