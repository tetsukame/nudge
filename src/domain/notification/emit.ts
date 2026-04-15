import type pg from 'pg';

export type NotificationKind =
  | 'created'
  | 'reminder_before'
  | 'due_today'
  | 're_notify'
  | 'completed';

export type EmitInput = {
  tenantId: string;
  recipientUserId: string;
  requestId: string | null;
  assignmentId: string | null;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

/**
 * Inserts a pending in_app notification row. Actual delivery (email/teams/slack)
 * is handled by the v0.6+ notification worker which reads pending rows.
 */
export async function emitNotification(
  client: pg.PoolClient,
  input: EmitInput,
): Promise<void> {
  await client.query(
    `INSERT INTO notification
       (tenant_id, request_id, assignment_id, recipient_user_id,
        channel, kind, scheduled_at, status, payload_json)
     VALUES ($1, $2, $3, $4, 'in_app', $5, now(), 'pending', $6::jsonb)`,
    [
      input.tenantId,
      input.requestId,
      input.assignmentId,
      input.recipientUserId,
      input.kind,
      JSON.stringify(input.payload),
    ],
  );
}
