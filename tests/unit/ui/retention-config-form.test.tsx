// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RetentionConfigForm } from '../../../src/ui/components/retention-config-form';

const initial = {
  enabled: false,
  hardDeleteEnabled: false,
  notificationDays: 90,
  auditLogDays: 730,
  historyDays: 365,
  syncLogDays: 90,
  softDeleteGraceDays: 7,
  isUsingPlatformDefault: true,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function getSaveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^保存(中\.\.\.)?$/ }) as HTMLButtonElement;
}

describe('NDG-94: RetentionConfigForm client validation', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
  });
  afterEach(() => { fetchSpy.mockRestore(); });

  it('initial render: save button enabled with default values', () => {
    render(<RetentionConfigForm tenantCode="dev" initial={initial} />);
    expect(getSaveButton().disabled).toBe(false);
  });

  it('typing 0 in a *_days field disables save and shows inline warning', () => {
    render(<RetentionConfigForm tenantCode="dev" initial={initial} />);
    fireEvent.change(screen.getByLabelText('通知履歴 (日数)'), { target: { value: '0' } });

    expect(getSaveButton().disabled).toBe(true);
    // Label と warning の両方に「通知履歴」が出るので、warning 固有の文言で確認
    expect(screen.queryByText(/1 以上の整数/)).not.toBeNull();
  });

  it('clicking save with 0 does not call fetch', async () => {
    render(<RetentionConfigForm tenantCode="dev" initial={initial} />);
    fireEvent.change(screen.getByLabelText('通知履歴 (日数)'), { target: { value: '0' } });
    fireEvent.click(getSaveButton());
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('empty *_days field is valid (means "use platform default") and submits null', async () => {
    render(<RetentionConfigForm tenantCode="dev" initial={initial} />);
    fireEvent.change(screen.getByLabelText('通知履歴 (日数)'), { target: { value: '' } });
    expect(getSaveButton().disabled).toBe(false);

    fireEvent.click(getSaveButton());
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.notificationDays).toBeNull();
  });

  it('1 以上の整数 is valid and submitted as number', async () => {
    render(<RetentionConfigForm tenantCode="dev" initial={initial} />);
    fireEvent.change(screen.getByLabelText('通知履歴 (日数)'), { target: { value: '30' } });
    fireEvent.click(getSaveButton());
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.notificationDays).toBe(30);
  });

  it('multiple invalid fields are all listed in the warning', () => {
    render(<RetentionConfigForm tenantCode="dev" initial={initial} />);
    fireEvent.change(screen.getByLabelText('通知履歴 (日数)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('監査ログ (日数)'), { target: { value: '-5' } });
    expect(screen.queryByText(/通知履歴.*監査ログ/)).not.toBeNull();
  });
});
