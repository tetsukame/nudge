import { notFound } from 'next/navigation';
import { LifeBuoy } from 'lucide-react';
import { isEmergencyLoginEnabled } from '@/domain/auth/emergency-login';
import { adminPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { PageHeader } from '@/ui/components/page-header';
import { RescueLoginForm } from '@/ui/components/rescue-login-form';

export const runtime = 'nodejs';

/**
 * NDG-118: 緊急ローカル管理者ログイン画面。
 * env `EMERGENCY_LOCAL_LOGIN=true` の時のみ表示。
 * 未設定なら 404 で存在自体を隠す。
 */
export default async function RescueLoginPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  if (!isEmergencyLoginEnabled()) notFound();

  const { code } = await params;
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) notFound();

  return (
    <div className="max-w-md mx-auto px-4 py-8 space-y-6">
      <PageHeader
        icon={<LifeBuoy />}
        title="緊急ログイン"
        description={`テナント "${tenant.name}" (${code}) の tenant_admin として復旧ログインします。`}
      />

      <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-900 space-y-1">
        <p className="font-medium">⚠️ この経路は認証設定ミスからの復旧専用です</p>
        <ul className="list-disc list-inside text-xs space-y-0.5">
          <li>Platform admin の bcrypt パスワードで認証します</li>
          <li>認証成功時、この tenant に緊急 tenant_admin ユーザーが作成 / 更新され、tenant_admin 権限が付与されます</li>
          <li>この操作は監査ログに <code>login.emergency_local</code> として記録されます</li>
          <li>復旧作業が終わったら <code>EMERGENCY_LOCAL_LOGIN</code> を <code>false</code> に戻し、サーバー再起動してください</li>
        </ul>
      </div>

      <RescueLoginForm tenantCode={code} />
    </div>
  );
}
