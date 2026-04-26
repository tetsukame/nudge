export type TenantSettings = {
  tenantId: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPasswordEncrypted: string | null;
  smtpFrom: string | null;
  smtpSecure: boolean;
  reminderBeforeDays: number;
  reNotifyIntervalDays: number;
  reNotifyMaxCount: number;
};
