import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

export type VerifyAccessToken = (token: string) => Promise<string>;

export function createAccessVerifier(options: {
  issuer: string;
  audience: string;
  jwks: JWTVerifyGetKey;
}): VerifyAccessToken {
  return async (token) => {
    const { payload } = await jwtVerify(token, options.jwks, {
      issuer: options.issuer,
      audience: options.audience,
    });
    if (typeof payload.email !== 'string' || payload.email === '') {
      throw new Error('The Access token has no email.');
    }
    return payload.email.toLowerCase();
  };
}

export function remoteAccessVerifier(teamDomain: string, audience: string): VerifyAccessToken {
  const issuer = `https://${teamDomain}`;
  return createAccessVerifier({
    issuer,
    audience,
    jwks: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
  });
}
