import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

export function registerWeb(app: FastifyInstance, webRoot: string): void {
  app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !isApiPath(request.url)) return reply.sendFile('index.html');
    return reply.status(404).send({ error: 'not_found' });
  });
}

export function isApiPath(url: string): boolean {
  try {
    return decodeURIComponent(new URL(url, 'http://localhost').pathname).startsWith('/api/');
  } catch {
    // A path that does not decode is treated as an API path, so it is authenticated.
    return true;
  }
}
