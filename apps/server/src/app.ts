import Fastify, { type FastifyInstance } from 'fastify';
import { remoteAccessVerifier, type VerifyAccessToken } from './auth/accessVerifier';
import { registerAuth } from './auth/authHook';
import type { Config } from './config';
import type { Database } from './db/openDatabase';
import { handleError } from './httpError';
import { nacionalProviderFactory, type ProviderFactory } from './providers/providerFactory';
import { IdentityRepository } from './repos/IdentityRepository';
import { adminRoutes } from './routes/admin';
import { emitterRoutes } from './routes/emitters';
import { meRoutes } from './routes/me';
import { memberRoutes } from './routes/members';

declare module 'fastify' {
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
  }
}

export interface AppDeps {
  config: Config;
  db: Database;
  verifyAccessToken?: VerifyAccessToken;
  providerFactory?: ProviderFactory;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db } = deps;
  const app = Fastify({ logger: config.nodeEnv !== 'test' });
  const routeList: { method: string; url: string }[] = [];
  app.decorate('routeList', routeList);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') routeList.push({ method, url: route.url });
    }
  });
  app.setErrorHandler(handleError);

  const verifyAccessToken =
    deps.verifyAccessToken ??
    (config.auth.mode === 'access'
      ? remoteAccessVerifier(config.auth.teamDomain, config.auth.audience)
      : async () => '');
  registerAuth(app, { config, identities: new IdentityRepository(db), verifyAccessToken });

  app.get('/api/health', async () => ({ status: 'ok' }));
  meRoutes(app);
  adminRoutes(app, db);
  memberRoutes(app, db);
  emitterRoutes(app, {
    db,
    masterKey: config.masterKey,
    providerFactory: deps.providerFactory ?? nacionalProviderFactory(config.nacionalUrls),
  });
  return app;
}
