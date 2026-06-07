'use client';

import { useCallback, useState } from 'react';

/**
 * NDG-92 (A2 E6): クライアントの非同期アクション共通パターン。
 *
 * 5 箇所 (scheduled-cancel-button / ai-format-modal / requester-reassign /
 * sent-card-actions / action-buttons) で `busy / error / result` の同じ
 * state を毎回手書きしていたのを集約する。
 *
 * 使い方:
 *   const action = useAsyncAction(async () => {
 *     await apiFetch('/api/...', { method: 'PATCH', ... });
 *     router.refresh();
 *   });
 *   <Button onClick={() => void action.run()} disabled={action.busy}>...</Button>
 *   {action.error && <p>{action.error}</p>}
 */
export type AsyncActionState<T> = {
  busy: boolean;
  error: string;
  result: T | null;
};

export type AsyncAction<T> = AsyncActionState<T> & {
  run: () => Promise<T | null>;
  reset: () => void;
};

export function useAsyncAction<T = void>(
  fn: () => Promise<T>,
): AsyncAction<T> {
  const [state, setState] = useState<AsyncActionState<T>>({
    busy: false, error: '', result: null,
  });

  const run = useCallback(async () => {
    setState({ busy: true, error: '', result: null });
    try {
      const result = await fn();
      setState({ busy: false, error: '', result });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'エラー';
      setState({ busy: false, error, result: null });
      return null;
    }
  }, [fn]);

  const reset = useCallback(() => {
    setState({ busy: false, error: '', result: null });
  }, []);

  return { ...state, run, reset };
}
