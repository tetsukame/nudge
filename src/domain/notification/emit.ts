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

const DEFAULT_CHANNELS = ['in_app', 'email'];

/**
 * Returns the list of enabled channels for the given tenant.
 * Falls back to ['in_app', 'email'] when no rows are configured.
 */
async function getChannelsForKind(
  client: pg.PoolClient,
  tenantId: string,
  _kind: NotificationKind,
): Promise<string[]> {
  const { rows } = await client.query<{ channel: string }>(
    `SELECT channel FROM tenant_notification_config
     WHERE tenant_id = $1 AND enabled = true`,
    [tenantId],
  );
  if (rows.length === 0) {
    return DEFAULT_CHANNELS;
  }
  return rows.map((r) => r.channel);
}

/**
 * Inserts a pending notification row per enabled channel.
 * Channels are read from tenant_notification_config; defaults to in_app + email.
 */
export async function emitNotification(
  client: pg.PoolClient,
  input: EmitInput,
): Promise<void> {
  const channels = await getChannelsForKind(client, input.tenantId, input.kind);
  for (const channel of channels) {
    await client.query(
      `INSERT INTO notification
         (tenant_id, request_id, assignment_id, recipient_user_id,
          channel, kind, scheduled_at, status, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 'pending', $7::jsonb)`,
      [
        input.tenantId,
        input.requestId,
        input.assignmentId,
        input.recipientUserId,
        channel,
        input.kind,
        JSON.stringify(input.payload),
      ],
    );
  }
}
