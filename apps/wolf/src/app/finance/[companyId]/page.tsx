import { Suspense } from "react";
import { FinanceApplication } from "../finance-application";

export default function FinanceCompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted">Checking finance access…</p>}>
      <Company params={params} />
    </Suspense>
  );
}

async function Company({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  return <FinanceApplication companyId={companyId} />;
}
