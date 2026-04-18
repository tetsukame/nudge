import type pg from 'pg';
import { withTenant } from '../../db/with-tenant.js';
import type { ActorContext } from '../types.js';

export type CommentItem = {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: Date;
};

export type ListCommentsResult = {
  broadcasts: CommentItem[];
  myThread: CommentItem[];
  allThreads?: Record<string, CommentItem[]>;
};

type CommentRow = {
  id: string;
  author_user_id: string;
  display_name: string;
  body: string;
  created_at: Date;
  assignment_id: string | null;
};

function toItem(row: CommentRow): CommentItem {
  return {
    id: row.id,
    authorUserId: row.author_user_id,
    authorName: row.display_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export async function listComments(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
): Promise<ListCommentsResult> {
  return withTenant(pool, actor.tenantId, async (client) => {
    // Determine if actor is the requester
    const { rows: reqRows } = await client.query<{ created_by_user_id: string }>(
      `SELECT created_by_user_id FROM request WHERE id = $1`,
      [requestId],
    );
    const isRequester =
      reqRows.length > 0 && reqRows[0].created_by_user_id === actor.userId;

    // Find actor's own assignment (if any)
    const { rows: myAsgRows } = await client.query<{ id: string }>(
      `SELECT id FROM assignment WHERE request_id = $1 AND user_id = $2 LIMIT 1`,
      [requestId, actor.userId],
    );
    const myAssignmentId = myAsgRows.length > 0 ? myAsgRows[0].id : null;

    // Fetch broadcasts (assignment_id IS NULL)
    const { rows: broadcastRows } = await client.query<CommentRow>(
      `SELECT rc.id, rc.author_user_id, u.display_name, rc.body, rc.created_at,
              rc.assignment_id
         FROM request_comment rc
         JOIN users u ON u.id = rc.author_user_id
        WHERE rc.request_id = $1
          AND rc.assignment_id IS NULL
        ORDER BY rc.created_at ASC`,
      [requestId],
    );
    const broadcasts = broadcastRows.map(toItem);

    // Fetch actor's own thread
    let myThread: CommentItem[] = [];
    if (myAssignmentId !== null) {
      const { rows: myThreadRows } = await client.query<CommentRow>(
        `SELECT rc.id, rc.author_user_id, u.display_name, rc.body, rc.created_at,
                rc.assignment_id
           FROM request_comment rc
           JOIN users u ON u.id = rc.author_user_id
          WHERE rc.request_id = $1
            AND rc.assignment_id = $2
          ORDER BY rc.created_at ASC`,
        [requestId, myAssignmentId],
      );
      myThread = myThreadRows.map(toItem);
    }

    // allThreads: only for the requester
    let allThreads: Record<string, CommentItem[]> | undefined;
    if (isRequester) {
      const { rows: allRows } = await client.query<CommentRow>(
        `SELECT rc.id, rc.author_user_id, u.display_name, rc.body, rc.created_at,
                rc.assignment_id
           FROM request_comment rc
           JOIN users u ON u.id = rc.author_user_id
          WHERE rc.request_id = $1
            AND rc.assignment_id IS NOT NULL
          ORDER BY rc.assignment_id, rc.created_at ASC`,
        [requestId],
      );
      allThreads = {};
      for (const row of allRows) {
        const asgId = row.assignment_id!;
        if (!allThreads[asgId]) {
          allThreads[asgId] = [];
        }
        allThreads[asgId].push(toItem(row));
      }
    }

    return { broadcasts, myThread, allThreads };
  });
}
