import type { AccountContext, AdminContext } from '@notaflow/core';
import type { FastifyRequest } from 'fastify';
import { HttpError } from '../httpError';
import type { Identity } from '../repos/IdentityRepository';

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null;
  }
}

export function identityOf(request: FastifyRequest): Identity {
  if (!request.identity) throw new HttpError(401, 'unauthenticated');
  return request.identity;
}

export function adminContext(request: FastifyRequest): AdminContext {
  const identity = identityOf(request);
  if (identity.platformRole !== 'admin') throw new HttpError(403, 'admin_only');
  return { userId: identity.userId, admin: true };
}

export function accountContext(
  request: FastifyRequest,
  accountId: string,
  options: { owner?: boolean; write?: boolean } = {},
): AccountContext {
  const identity = identityOf(request);
  const membership = identity.memberships.find((m) => m.accountId === accountId);
  // 404, not 403: an account a user does not belong to must look like it does not exist.
  if (!membership) throw new HttpError(404, 'not_found');
  if (options.owner && membership.role !== 'owner') throw new HttpError(403, 'owner_only');
  if (options.write && membership.accountStatus === 'suspended') {
    throw new HttpError(403, 'account_suspended');
  }
  return {
    accountId,
    userId: identity.userId,
    role: membership.role,
    accountStatus: membership.accountStatus,
  };
}
