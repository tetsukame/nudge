// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAsyncAction } from '../../../src/ui/hooks/use-async-action';

describe('useAsyncAction', () => {
  it('starts idle (busy=false, error="", result=null)', () => {
    const { result } = renderHook(() => useAsyncAction(async () => 'OK'));
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.result).toBeNull();
  });

  it('successful run sets result and clears error', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => ({ value: 42 })),
    );
    await act(async () => {
      const r = await result.current.run();
      expect(r).toEqual({ value: 42 });
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.result).toEqual({ value: 42 });
  });

  it('failed run captures error.message and returns null', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => { throw new Error('boom'); }),
    );
    await act(async () => {
      const r = await result.current.run();
      expect(r).toBeNull();
    });
    expect(result.current.error).toBe('boom');
    expect(result.current.result).toBeNull();
  });

  it('non-Error throw becomes generic message', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => { throw 'not an error'; }),
    );
    await act(async () => { await result.current.run(); });
    expect(result.current.error).toBe('エラー');
  });

  it('reset() clears all state', async () => {
    const { result } = renderHook(() =>
      useAsyncAction(async () => 'OK'),
    );
    await act(async () => { await result.current.run(); });
    expect(result.current.result).toBe('OK');
    act(() => { result.current.reset(); });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.result).toBeNull();
  });

  it('successful run after failure clears error', async () => {
    let shouldFail = true;
    const { result, rerender } = renderHook(() =>
      useAsyncAction(async () => {
        if (shouldFail) throw new Error('first');
        return 'OK';
      }),
    );
    await act(async () => { await result.current.run(); });
    expect(result.current.error).toBe('first');
    shouldFail = false;
    rerender();
    await act(async () => { await result.current.run(); });
    expect(result.current.error).toBe('');
    expect(result.current.result).toBe('OK');
  });
});
