import type pg from 'pg';

async function getEnabledChannels(client: pg.PoolClient, tenantId: string): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT channel FROM tenant_notification_config
      WHERE tenant_id = $1 AND enabled = true`,
    [tenantId],
  );
  if (rows.length === 0) return ['in_app', 'email'];
  return rows.map((r) => r.channel as string);
}

type TenantRow = {
  id: string;
};

type SchedulerSettingsRow = {
  reminder_before_days: number;
  re_notify_interval_days: number;
  re_notify_max_count: number;
};

async function loadSchedulerSettings(
  client: pg.PoolClient,
  tenantId: string,
): Promise<SchedulerSettingsRow> {
  const { rows } = await client.query<SchedulerSettingsRow>(
    `SELECT reminder_before_days, re_notify_interval_days, re_notify_max_count
       FROM tenant_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  if (rows.length === 0) {
    return { reminder_before_days: 1, re_notify_interval_days: 3, re_notify_max_count: 5 };
  }
  return rows[0];
}

async function insertNotificationsForCandidates(
  client: pg.PoolClient,
  candidates: Array<{
    tenantId: string;
    requestId: string;
    assignmentId: string;
    userId: string;
  }>,
  channels: string[],
  kind: string,
): Promise<void> {
  for (const c of candidates) {
    for (const channel of channels) {
      await client.query(
        `INSERT INTO notification(tenant_id, request_id, assignment_id, recipient_user_id,
                                  channel, kind, scheduled_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, now(), 'pending')`,
        [c.tenantId, c.requestId, c.assignmentId, c.userId, channel, kind],
      );
    }
  }
}

/**
 * Generates reminder_before notifications for assignments where due_at is
 * (reminder_before_days) days from today and no such notification exists yet.
 */
async function generateReminderBefore(client: pg.PoolClient): Promise<void> {
  const { rows: tenants } = await client.query<TenantRow>(`SELECT id FROM tenant`);

  for (const tenant of tenants) {
    const settings = await loadSchedulerSettings(client, tenant.id);
    const channels = await getEnabledChannels(client, tenant.id);

    const { rows } = await client.query(
      `SELECT a.id AS assignment_id, a.request_id, a.user_id
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.tenant_id = $1
          AND r.tenant_id = $1
          AND r.status = 'active'
          AND r.due_at IS NOT NULL
          AND a.status IN ('unopened', 'opened')
          AND (r.due_at::date - $2::int)::date = (now())::date
          AND NOT EXISTS (
            SELECT 1 FROM notification n
             WHERE n.tenant_id = $1
               AND n.assignment_id = a.id
               AND n.kind = 'reminder_before'
          )`,
      [tenant.id, settings.reminder_before_days],
    );

    const candidates = rows.map((r) => ({
      tenantId: tenant.id,
      requestId: r.request_id as string,
      assignmentId: r.assignment_id as string,
      userId: r.user_id as string,
    }));

    await insertNotificationsForCandidates(client, candidates, channels, 'reminder_before');
  }
}

/**
 * Generates due_today notifications for assignments where due_at is today
 * and no such notification exists yet.
 */
async function generateDueToday(client: pg.PoolClient): Promise<void> {
  const { rows: tenants } = await client.query<TenantRow>(`SELECT id FROM tenant`);

  for (const tenant of tenants) {
    const channels = await getEnabledChannels(client, tenant.id);

    const { rows } = await client.query(
      `SELECT a.id AS assignment_id, a.request_id, a.user_id
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.tenant_id = $1
          AND r.tenant_id = $1
          AND r.status = 'active'
          AND r.due_at IS NOT NULL
          AND a.status IN ('unopened', 'opened')
          AND r.due_at::date = (now())::date
          AND NOT EXISTS (
            SELECT 1 FROM notification n
             WHERE n.tenant_id = $1
               AND n.assignment_id = a.id
               AND n.kind = 'due_today'
          )`,
      [tenant.id],
    );

    const candidates = rows.map((r) => ({
      tenantId: tenant.id,
      requestId: r.request_id as string,
      assignmentId: r.assignment_id as string,
      userId: r.user_id as string,
    }));

    await insertNotificationsForCandidates(client, candidates, channels, 'due_today');
  }
}

/**
 * Generates re_notify notifications for overdue assignments, respecting
 * interval and max count settings.
 */
async function generateReNotify(client: pg.PoolClient): Promise<void> {
  const { rows: tenants } = await client.query<TenantRow>(`SELECT id FROM tenant`);

  for (const tenant of tenants) {
    const settings = await loadSchedulerSettings(client, tenant.id);
    const channels = await getEnabledChannels(client, tenant.id);

    const { rows } = await client.query(
      `SELECT a.id AS assignment_id, a.request_id, a.user_id
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.tenant_id = $1
          AND r.tenant_id = $1
          AND r.status = 'active'
          AND r.due_at IS NOT NULL
          AND r.due_at < now()
          AND a.status IN ('unopened', 'opened')
          AND (
            SELECT COUNT(*) FROM notification n
             WHERE n.tenant_id = $1
               AND n.assignment_id = a.id
               AND n.kind = 're_notify'
               AND n.channel = 'in_app'
          ) < $2
          AND (
            (
              SELECT MAX(n.scheduled_at) FROM notification n
               WHERE n.tenant_id = $1
                 AND n.assignment_id = a.id
                 AND n.kind = 're_notify'
                 AND n.channel = 'in_app'
            ) IS NULL
            OR (
              SELECT MAX(n.scheduled_at) FROM notification n
               WHERE n.tenant_id = $1
                 AND n.assignment_id = a.id
                 AND n.kind = 're_notify'
                 AND n.channel = 'in_app'
            ) < now() - ($3::int * interval '1 day')
          )`,
      [tenant.id, settings.re_notify_max_count, settings.re_notify_interval_days],
    );

    const candidates = rows.map((r) => ({
      tenantId: tenant.id,
      requestId: r.request_id as string,
      assignmentId: r.assignment_id as string,
      userId: r.user_id as string,
    }));

    await insertNotificationsForCandidates(client, candidates, channels, 're_notify');
  }
}

export async function runScheduler(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await generateReminderBefore(client);
    await generateDueToday(client);
    await generateReNotify(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
