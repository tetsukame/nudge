import { redirect } from 'next/navigation';

export default async function TenantDashboard({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  redirect(`/t/${code}/requests`);
}
