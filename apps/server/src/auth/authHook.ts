import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import { HttpError } from '../httpError';
import type { IdentityRepository } from '../repos/IdentityRepository';
import type { VerifyAccessToken } from './accessVerifier';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerAuth(
  app: FastifyInstance,
  deps: { config: Config; identities: IdentityRepository; verifyAccessToken: VerifyAccessToken },
): void {
  app.decorateRequest('identity', null);
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || request.url === '/api/health') return;
    const email = await emailOf(request, deps.config, deps.verifyAccessToken);
    const identity = deps.identities.findByEmail(email);
    if (!identity) throw new HttpError(403, 'access_not_granted');
    if (MUTATIONS.has(request.method)) {
      if (request.headers.origin !== deps.config.appOrigin) throw new HttpError(403, 'bad_origin');
      if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
        throw new HttpError(415, 'json_required');
      }
    }
    request.identity = identity;
  });
}

async function emailOf(
  request: FastifyRequest,
  config: Config,
  verify: VerifyAccessToken,
): Promise<string> {
  if (config.auth.mode === 'dev') return config.auth.email;
  const token = request.headers['cf-access-jwt-assertion'];
  if (typeof token !== 'string' || token === '') throw new HttpError(401, 'unauthenticated');
  try {
    return await verify(token);
  } catch {
    throw new HttpError(401, 'unauthenticated');
  }
}
