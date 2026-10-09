export type AccountRole = 'owner' | 'member';

// Built only by the server's guards, after the membership check.
export interface AccountContext {
  accountId: string;
  userId: string;
  role: AccountRole;
  accountStatus: 'active' | 'suspended';
}

export interface AdminContext {
  userId: string;
  admin: true;
}
