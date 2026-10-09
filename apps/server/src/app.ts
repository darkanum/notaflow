import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import { handleError } from './httpError';

export interface AppDeps {
  config: Config;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.config.nodeEnv !== 'test' });
  app.setErrorHandler(handleError);
  app.get('/api/health', async () => ({ status: 'ok' }));
  return app;
}
