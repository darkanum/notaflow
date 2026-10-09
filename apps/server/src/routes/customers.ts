import type { PartyAddress } from '@notaflow/core';
import type { FastifyInstance } from 'fastify';
import { accountContext, identityOf } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { AuditLog } from '../repos/AuditLog';
import { CustomerRepository, type CustomerRow } from '../repos/CustomerRepository';

interface CustomerEdit {
  name?: string;
  email?: string;
  phone?: string;
  municipalRegistration?: string;
  address?: PartyAddress;
}

const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });

const editSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: text(150),
      email: { type: 'string', format: 'email', maxLength: 80 },
      phone: { type: 'string', pattern: '^[0-9]{6,20}$' },
      municipalRegistration: text(15),
      address: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'street', 'number', 'district'],
        properties: {
          kind: { enum: ['domestic', 'foreign'] },
          municipality: { type: 'string', pattern: '^[0-9]{7}$' },
          zip: { type: 'string', pattern: '^[0-9]{8}$' },
          country: { type: 'string', pattern: '^[A-Z]{2}$' },
          postalCode: text(11),
          city: text(60),
          region: text(60),
          street: text(255),
          number: text(60),
          complement: text(156),
          district: text(60),
        },
      },
    },
  },
} as const;

const REQUIRED_BY_KIND = {
  domestic: ['municipality', 'zip'],
  foreign: ['country', 'postalCode', 'city', 'region'],
} as const;

function withoutManualFields({ manualFields: _manualFields, ...customer }: CustomerRow) {
  return customer;
}

export function customerRoutes(app: FastifyInstance, db: Database): void {
  const customers = new CustomerRepository(db);
  const audit = new AuditLog(db);

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
        .map(withoutManualFields);
    },
  );

  app.get<{ Params: { accountId: string; customerId: string } }>(
    '/api/accounts/:accountId/customers/:customerId',
    async (request) => {
      const ctx = accountContext(request, request.params.accountId);
      const customer = customers.get(ctx, request.params.customerId);
      if (!customer) throw new HttpError(404, 'not_found');
      return withoutManualFields(customer);
    },
  );

  app.put<{ Params: { accountId: string; customerId: string }; Body: CustomerEdit }>(
    '/api/accounts/:accountId/customers/:customerId',
    { schema: editSchema },
    async (request) => {
      const ctx = accountContext(request, request.params.accountId, { write: true });
      const { address } = request.body;
      if (address && REQUIRED_BY_KIND[address.kind].some((field) => !(field in address))) {
        throw new HttpError(400, 'invalid_address');
      }
      if (!customers.setManual(ctx, request.params.customerId, request.body)) {
        throw new HttpError(404, 'not_found');
      }
      audit.record({
        userEmail: identityOf(request).email,
        accountId: ctx.accountId,
        action: 'customer.edit',
        entity: request.params.customerId,
        result: 'ok',
        detail: Object.keys(request.body).join(', '),
      });
      const customer = customers.get(ctx, request.params.customerId);
      if (!customer) throw new HttpError(404, 'not_found');
      return withoutManualFields(customer);
    },
  );
}
