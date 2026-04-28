export type AssignmentStatus =
  | 'unopened'
  | 'opened'
  | 'responded'
  | 'not_needed'
  | 'forwarded'
  | 'substituted'
  | 'exempted'
  | 'expired';

export type ActorRole = 'assignee' | 'requester' | 'manager' | 'tenant_admin';

export type ActorContext = {
  userId: string;
  tenantId: string;
  isTenantAdmin: boolean;
  isTenantWideRequester: boolean;
};

export type ExpandBreakdown = {
  user: number;
  org_unit: number;
  group: number;
  all: number;
};
