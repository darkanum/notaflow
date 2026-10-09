import type { FastifyInstance } from 'fastify';
import { identityOf } from '../auth/guards';

export function meRoutes(app: FastifyInstance): void {
  app.get('/api/me', async (request) => {
    const identity = identityOf(request);
    return {
      email: identity.email,
      name: identity.name,
      platformRole: identity.platformRole,
      accounts: identity.memberships.map((m) => ({
        id: m.accountId,
        name: m.accountName,
        role: m.role,
        status: m.accountStatus,
      })),
    };
  });
}
