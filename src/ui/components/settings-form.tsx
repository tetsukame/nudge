'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationSettingsView } from '@/domain/settings/get';

// ---- Sub-components ----

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-5 space-y-4 bg-white">
      <h2 className="text-base font-semibold text-gray-800">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
      <label className="text-sm font-medium text-gray-700 w-36 shrink-0">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-blue-600"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  );
}

function SecretField({
  hasExisting,
  value,
  onChange,
}: {
  hasExisting: boolean;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (value === null) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">
          {hasExisting ? '●●●●●●' : '(未設定)'}
        </span>
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          {hasExisting ? '変更' : '設定'}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input flex-1"
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={() => onChange(null)}
        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
      >
        キャンセル
      </button>
    </div>
  );
}

// ---- Main form ----

type Props = {
  tenantCode: string;
  initial: NotificationSettingsView;
};

export function SettingsForm({ tenantCode, initial }: Props) {
  const router = useRouter();

  const [smtp, setSmtp] = useState({
    host: initial.smtp.host ?? '',
    port: initial.smtp.port ?? ('' as number | ''),
    user: initial.smtp.user ?? '',
    from: initial.smtp.from ?? '',
    secure: initial.smtp.secure,
  });
  const [smtpPassword, setSmtpPassword] = useState<string | null>(null);
  const [teamsUrl, setTeamsUrl] = useState<string | null>(null);
  const [slackUrl, setSlackUrl] = useState<string | null>(null);
  const [channels, setChannels] = useState(initial.channels);
  const [reminders, setReminders] = useState(initial.reminders);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);

    const body: Record<string, unknown> = {
      smtp: {
        host: smtp.host || null,
        port: smtp.port === '' ? null : Number(smtp.port),
        user: smtp.user || null,
        from: smtp.from || null,
        secure: smtp.secure,
        ...(smtpPassword !== null ? { password: smtpPassword } : {}),
      },
      teams: {
        ...(teamsUrl !== null ? { webhookUrl: teamsUrl } : {}),
      },
      slack: {
        ...(slackUrl !== null ? { webhookUrl: slackUrl } : {}),
      },
      channels,
      reminders,
    };

    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/settings/notification`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError((json as { error?: string }).error ?? `エラー: ${res.status}`);
        return;
      }

      setSmtpPassword(null);
      setTeamsUrl(null);
      setSlackUrl(null);
      setSuccess(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラー');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* SMTP */}
      <Section title="メール (SMTP)">
        <Toggle
          checked={channels.email}
          onChange={(v) => setChannels((c) => ({ ...c, email: v }))}
          label="メール通知を有効にする"
        />
        <Field label="SMTPホスト">
          <input
            type="text"
            value={smtp.host}
            onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))}
            className="input w-full"
            placeholder="smtp.example.com"
          />
        </Field>
        <Field label="ポート">
          <input
            type="number"
            value={smtp.port}
            onChange={(e) => setSmtp((s) => ({ ...s, port: e.target.value === '' ? '' : Number(e.target.value) }))}
            className="input w-28"
            placeholder="587"
          />
        </Field>
        <Field label="ユーザー">
          <input
            type="text"
            value={smtp.user}
            onChange={(e) => setSmtp((s) => ({ ...s, user: e.target.value }))}
            className="input w-full"
            placeholder="user@example.com"
          />
        </Field>
        <Field label="パスワード">
          <SecretField
            hasExisting={initial.smtp.hasPassword}
            value={smtpPassword}
            onChange={setSmtpPassword}
          />
        </Field>
        <Field label="送信元アドレス">
          <input
            type="text"
            value={smtp.from}
            onChange={(e) => setSmtp((s) => ({ ...s, from: e.target.value }))}
            className="input w-full"
            placeholder="noreply@example.com"
          />
        </Field>
        <Toggle
          checked={smtp.secure}
          onChange={(v) => setSmtp((s) => ({ ...s, secure: v }))}
          label="SSL/TLS を使用する"
        />
      </Section>

      {/* Teams */}
      <Section title="Microsoft Teams">
        <Toggle
          checked={channels.teams}
          onChange={(v) => setChannels((c) => ({ ...c, teams: v }))}
          label="Teams 通知を有効にする"
        />
        <Field label="Webhook URL">
          <SecretField
            hasExisting={initial.teams.hasWebhookUrl}
            value={teamsUrl}
            onChange={setTeamsUrl}
          />
        </Field>
      </Section>

      {/* Slack */}
      <Section title="Slack">
        <Toggle
          checked={channels.slack}
          onChange={(v) => setChannels((c) => ({ ...c, slack: v }))}
          label="Slack 通知を有効にする"
        />
        <Field label="Webhook URL">
          <SecretField
            hasExisting={initial.slack.hasWebhookUrl}
            value={slackUrl}
            onChange={setSlackUrl}
          />
        </Field>
      </Section>

      {/* In-App */}
      <Section title="アプリ内通知">
        <Toggle
          checked={channels.in_app}
          onChange={(v) => setChannels((c) => ({ ...c, in_app: v }))}
          label="アプリ内通知を有効にする"
        />
      </Section>

      {/* Reminders */}
      <Section title="リマインダー設定">
        <Field label="事前通知 (日前)">
          <input
            type="number"
            min={0}
            value={reminders.reminderBeforeDays}
            onChange={(e) => setReminders((r) => ({ ...r, reminderBeforeDays: Number(e.target.value) }))}
            className="input w-20"
          />
        </Field>
        <Field label="再通知間隔 (日)">
          <input
            type="number"
            min={1}
            value={reminders.reNotifyIntervalDays}
            onChange={(e) => setReminders((r) => ({ ...r, reNotifyIntervalDays: Number(e.target.value) }))}
            className="input w-20"
          />
        </Field>
        <Field label="最大再通知回数">
          <input
            type="number"
            min={0}
            value={reminders.reNotifyMaxCount}
            onChange={(e) => setReminders((r) => ({ ...r, reNotifyMaxCount: Number(e.target.value) }))}
            className="input w-20"
          />
        </Field>
      </Section>

      {/* Actions */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {success && <span className="text-sm text-green-600">保存しました</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      <style>{`
        .input {
          border: 1px solid #d1d5db;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 14px;
          background: white;
        }
      `}</style>
    </div>
  );
}
