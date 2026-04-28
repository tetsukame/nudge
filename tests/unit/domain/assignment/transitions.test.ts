import { describe, it, expect } from 'vitest';
import {
  canTransition,
  allowedTransitionsFrom,
  type TransitionIntent,
} from '../../../../src/domain/assignment/transitions.js';
import type { AssignmentStatus } from '../../../../src/domain/types.js';

describe('assignment state machine', () => {
  const TERMINAL: AssignmentStatus[] = [
    'responded', 'not_needed', 'forwarded', 'substituted', 'exempted', 'expired',
  ];

  it.each([
    ['unopened', 'opened', 'assignee', true],
    ['unopened', 'responded', 'assignee', true],
    ['unopened', 'not_needed', 'assignee', true],
    ['unopened', 'forwarded', 'assignee', true],
    ['opened', 'responded', 'assignee', true],
    ['opened', 'not_needed', 'assignee', true],
    ['opened', 'forwarded', 'assignee', true],
    ['unopened', 'substituted', 'requester', true],
    ['unopened', 'substituted', 'manager', true],
    ['opened', 'substituted', 'requester', true],
    ['opened', 'substituted', 'manager', true],
    ['unopened', 'substituted', 'assignee', false],
    ['unopened', 'exempted', 'tenant_admin', true],
    ['unopened', 'exempted', 'assignee', false],
    ['unopened', 'responded', 'manager', false],
    ['opened', 'unopened', 'assignee', false],
  ] as const)(
    '%s -> %s by %s => %s',
    (from, to, role, expected) => {
      const intent: TransitionIntent = { from, to, actorRole: role };
      expect(canTransition(intent)).toBe(expected);
    },
  );

  it('rejects any transition from every terminal status', () => {
    for (const from of TERMINAL) {
      expect(allowedTransitionsFrom(from)).toEqual([]);
    }
  });
});
