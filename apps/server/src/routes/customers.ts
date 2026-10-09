import type { FastifyInstance } from 'fastify';
import { accountContext } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { CustomerRepository } from '../repos/CustomerRepository';

export function customerRoutes(app: FastifyInstance, db: Database): void {
  const customers = new CustomerRepository(db);
  app.get<{ Params: { accountId: string }; Querystring: { emitterId?: string; q?: string } }>(
    '/api/accounts/:accountId/customers',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { emitterId: { type: 'string' }, q: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const { emitterId, q } = request.query;
      return customers
        .list(ctx, { ...(emitterId ? { emitterId } : {}), ...(q ? { search: q } : {}) })
        .map(({ manualFields: _manualFields, ...customer }) => customer);
    },
  );
}
