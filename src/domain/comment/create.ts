import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class CommentError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'not_found' | 'validation',
  ) {
    super(message);
    this.name = 'CommentError';
  }
}

export type CreateCommentInput = {
  requestId: string;
  assignmentId: string | null;
  body: string;
};

export type CreateCommentResult = {
  id: string;
  createdAt: Date;
};

export async function createComment(
  pool: pg.Pool,
  actor: ActorContext,
  input: CreateCommentInput,
): Promise<CreateCommentResult> {
  if (!input.body.trim()) {
    throw new CommentError('body required', 'validation');
  }

  return withTenant(pool, actor.tenantId, async (client) => {
    // Look up request to get requester
    const { rows: reqRows } = await client.query<{ created_by_user_id: string }>(
      `SELECT created_by_user_id FROM request WHERE id = $1`,
      [input.requestId],
    );
    if (reqRows.length === 0) {
      throw new CommentError('request not found', 'not_found');
    }
    const requesterId = reqRows[0].created_by_user_id;

    if (input.assignmentId === null) {
      // Broadcast: only the requester may post
      if (actor.userId !== requesterId) {
        throw new CommentError(
          'only the requester can post broadcast comments',
          'permission_denied',
        );
      }
    } else {
      // Individual thread: only the assignment's user or the requester may post
      const { rows: asgRows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM assignment WHERE id = $1 AND request_id = $2`,
        [input.assignmentId, input.requestId],
      );
      if (asgRows.length === 0) {
        throw new CommentError('assignment not found', 'not_found');
      }
      const assigneeId = asgRows[0].user_id;
      if (actor.userId !== assigneeId && actor.userId !== requesterId) {
        throw new CommentError(
          'only the assignee or requester can post in this thread',
          'permission_denied',
        );
      }
    }

    const { rows } = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO request_comment
         (tenant_id, request_id, assignment_id, author_user_id, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [actor.tenantId, input.requestId, input.assignmentId, actor.userId, input.body],
    );

    return { id: rows[0].id, createdAt: rows[0].created_at };
  });
}
