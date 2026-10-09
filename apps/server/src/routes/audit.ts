import type { FastifyInstance } from 'fastify';
import { adminContext } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { AuditLog } from '../repos/AuditLog';

export function auditRoutes(app: FastifyInstance, db: Database): void {
  const audit = new AuditLog(db);
  app.get<{ Querystring: { limit?: number } }>(
    '/api/admin/audit',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } },
        },
      },
    },
    async (request) => {
      adminContext(request);
      return audit.latest(request.query.limit ?? 100);
    },
  );
}
