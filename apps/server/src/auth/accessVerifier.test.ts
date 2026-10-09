import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, expect, test } from 'vitest';
import { createAccessVerifier, type VerifyAccessToken } from './accessVerifier';

const ISSUER = 'https://test.cloudflareaccess.com';
const AUDIENCE = 'aud';
let verify: VerifyAccessToken;
let privateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), alg: 'RS256' }],
  });
  verify = createAccessVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks });
});

function token(claims: Record<string, unknown>, withExp = true) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt();
  return (withExp ? jwt.setExpirationTime('5m') : jwt).sign(privateKey);
}

test('accepts an RS256 token with exp and email', async () => {
  expect(await verify(await token({ email: 'A@Example.com' }))).toBe('a@example.com');
});

test('refuses a token without exp', async () => {
  await expect(verify(await token({ email: 'a@example.com' }, false))).rejects.toThrow();
});

test('refuses a token without email', async () => {
  await expect(verify(await token({}))).rejects.toThrow();
});

test('refuses an HS256 token even with the right claims', async () => {
  const hs = await new SignJWT({ email: 'a@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('x'.repeat(32)));
  await expect(verify(hs)).rejects.toThrow();
});
