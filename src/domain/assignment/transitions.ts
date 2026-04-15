import type { AssignmentStatus, ActorRole } from '../types.js';

export type ActionName =
  | 'open'
  | 'respond'
  | 'unavailable'
  | 'forward'
  | 'substitute'
  | 'exempt';

export type TransitionRule = {
  to: AssignmentStatus;
  action: ActionName;
  actor: ActorRole;
  transitionKind:
    | 'auto_open'
    | 'user_respond'
    | 'user_unavailable'
    | 'user_forward'
    | 'manager_substitute'
    | 'admin_exempt';
  requiresReason: boolean;
};

export type TransitionIntent = {
  from: AssignmentStatus;
  to: AssignmentStatus;
  actorRole: ActorRole;
};

const RULES: Record<AssignmentStatus, TransitionRule[]> = {
  unopened: [
    { to: 'opened',      action: 'open',       actor: 'assignee',     transitionKind: 'auto_open',          requiresReason: false },
    { to: 'responded',   action: 'respond',    actor: 'assignee',     transitionKind: 'user_respond',       requiresReason: false },
    { to: 'unavailable', action: 'unavailable',actor: 'assignee',     transitionKind: 'user_unavailable',   requiresReason: true  },
    { to: 'forwarded',   action: 'forward',    actor: 'assignee',     transitionKind: 'user_forward',       requiresReason: false },
    { to: 'substituted', action: 'substitute', actor: 'requester',    transitionKind: 'manager_substitute', requiresReason: true  },
    { to: 'substituted', action: 'substitute', actor: 'manager',      transitionKind: 'manager_substitute', requiresReason: true  },
    { to: 'exempted',    action: 'exempt',     actor: 'tenant_admin', transitionKind: 'admin_exempt',       requiresReason: true  },
  ],
  opened: [
    { to: 'responded',   action: 'respond',    actor: 'assignee',     transitionKind: 'user_respond',       requiresReason: false },
    { to: 'unavailable', action: 'unavailable',actor: 'assignee',     transitionKind: 'user_unavailable',   requiresReason: true  },
    { to: 'forwarded',   action: 'forward',    actor: 'assignee',     transitionKind: 'user_forward',       requiresReason: false },
    { to: 'substituted', action: 'substitute', actor: 'requester',    transitionKind: 'manager_substitute', requiresReason: true  },
    { to: 'substituted', action: 'substitute', actor: 'manager',      transitionKind: 'manager_substitute', requiresReason: true  },
    { to: 'exempted',    action: 'exempt',     actor: 'tenant_admin', transitionKind: 'admin_exempt',       requiresReason: true  },
  ],
  responded:   [],
  unavailable: [],
  forwarded:   [],
  substituted: [],
  exempted:    [],
  expired:     [],
};

export function allowedTransitionsFrom(status: AssignmentStatus): TransitionRule[] {
  return RULES[status] ?? [];
}

export function canTransition(intent: TransitionIntent): boolean {
  return allowedTransitionsFrom(intent.from).some(
    (r) => r.to === intent.to && r.actor === intent.actorRole,
  );
}

export function findRule(
  from: AssignmentStatus,
  action: ActionName,
  actorRole: ActorRole,
): TransitionRule | undefined {
  return allowedTransitionsFrom(from).find(
    (r) => r.action === action && r.actor === actorRole,
  );
}
