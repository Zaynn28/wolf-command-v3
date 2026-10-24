import { addAccountAction, addPeriodAction, saveDraftAction } from "./actions";
import type { DraftJournalView } from "@/server/finance/drafts";

function amountAtScale(value: string, scale: number) {
  const [whole, fraction = ""] = value.split(".");
  const kept = fraction.slice(0, scale).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole || "0";
}

const notices: Record<string, string> = {
  balanced: "Draft saved. Debits equal credits. Posting is not enabled.",
  unbalanced: "Draft saved. Debits do not equal credits, so it cannot be treated as a balanced entry. Posting is not enabled.",
  account: "Account saved for this company.",
  period: "Period saved for this company.",
  denied: "That finance change was denied.",
  invalid: "The draft was not saved. Check the period, accounts, and amounts.",
  rejected: "The finance change was not saved.",
};

export function FinanceDesk({
  companyId,
  currencyCode,
  minorScale,
  accounts,
  periods,
  journals,
  notice,
  administrator,
}: {
  companyId: string;
  currencyCode: string;
  minorScale: number;
  accounts: { accountCode: string; accountName: string; active: string }[];
  periods: { periodKey: string }[];
  journals: DraftJournalView[];
  notice: string | null;
  administrator: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-line bg-surface px-4 py-4">
        <h2 className="text-sm font-semibold">Draft ledger</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Company {companyId}. Currency {currencyCode}, scale {minorScale}. Drafts are stored in the Wolf database for this company and remain after a reload. Amounts are exact decimals. Posting, reversal, and period close are not enabled. Hotel inventory, service charge, owner pool, petty cash, and tax are not enabled.
        </p>
        {notice && notices[notice] ? <p className="mt-3 text-sm text-foreground">{notices[notice]}</p> : null}
      </section>
      {administrator ? (
        <div className="grid gap-4 md:grid-cols-2">
          <form action={addAccountAction} className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-4">
            <h2 className="text-sm font-semibold">Add account</h2>
            <input type="hidden" name="companyId" value={companyId} />
            <input name="accountCode" placeholder="Account code" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
            <input name="accountName" placeholder="Account name" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
            <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Save account</button>
          </form>
          <form action={addPeriodAction} className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-4">
            <h2 className="text-sm font-semibold">Add period</h2>
            <input type="hidden" name="companyId" value={companyId} />
            <input name="periodKey" placeholder="YYYY-MM" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
            <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Save period</button>
          </form>
        </div>
      ) : (
        <p className="text-sm text-muted">Account and period setup requires an administrator membership for this company.</p>
      )}
      <form action={saveDraftAction} className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-4">
        <h2 className="text-sm font-semibold">New draft journal</h2>
        <input type="hidden" name="companyId" value={companyId} />
        <input name="periodKey" placeholder="YYYY-MM" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        <input name="memo" placeholder="Memo" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
        {[0, 1].map((index) => (
          <div key={index} className="grid gap-2 md:grid-cols-3">
            <input name={`line${index}Account`} placeholder="Account code" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
            <select name={`line${index}Side`} className="rounded-md border border-line bg-background px-3 py-2 text-sm">
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
            <input name={`line${index}Amount`} placeholder="Amount" className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
          </div>
        ))}
        <button type="submit" className="rounded-md bg-foreground px-3 py-2 text-sm text-background">Save draft</button>
      </form>
      <section>
        <h2 className="text-sm font-semibold">Accounts</h2>
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {accounts.length === 0 ? <li className="px-4 py-4 text-sm text-muted">No accounts yet.</li> : null}
          {accounts.map((account) => (
            <li key={account.accountCode} className="px-4 py-3 text-sm">
              {account.accountCode} · {account.accountName} · {account.active === "Y" ? "active" : "inactive"}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-semibold">Periods</h2>
        <p className="mt-1 text-sm text-muted">{periods.map((period) => period.periodKey).join(", ") || "No periods yet."}</p>
      </section>
      <section>
        <h2 className="text-sm font-semibold">Draft journals</h2>
        <ul className="mt-2 flex flex-col gap-3">
          {journals.length === 0 ? <li className="text-sm text-muted">No drafts yet.</li> : null}
          {journals.map((journal) => (
            <li key={journal.id} className="rounded-lg border border-line bg-surface px-4 py-4 text-sm">
              <p className="font-medium">{journal.id}</p>
              <p className="mt-1 text-muted">
                {journal.periodKey} · {journal.balanced ? "Balanced" : "Not balanced"} · Debit {journal.debit} · Credit {journal.credit}
              </p>
              <ul className="mt-2 text-muted">
                {journal.lines.map((line) => (
                  <li key={line.lineNo}>
                    {line.lineNo}. {line.accountCode} debit {line.debit} credit {line.credit}
                  </li>
                ))}
              </ul>
              <form action={saveDraftAction} className="mt-3 flex flex-col gap-2">
                <p className="text-muted">Replace these lines. Saving keeps the journal in draft.</p>
                <input type="hidden" name="companyId" value={companyId} />
                <input type="hidden" name="journalId" value={journal.id} />
                <input name="periodKey" defaultValue={journal.periodKey} className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
                <input name="memo" defaultValue={journal.memo} className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
                {[0, 1].map((index) => {
                  const line = journal.lines[index];
                  const credit = Boolean(line && line.credit !== "0.0000");
                  const amount = line ? amountAtScale(credit ? line.credit : line.debit, minorScale) : "";
                  return (
                    <div key={index} className="grid gap-2 md:grid-cols-3">
                      <input name={`line${index}Account`} defaultValue={line?.accountCode ?? ""} className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
                      <select name={`line${index}Side`} defaultValue={credit ? "credit" : "debit"} className="rounded-md border border-line bg-background px-3 py-2 text-sm">
                        <option value="debit">Debit</option>
                        <option value="credit">Credit</option>
                      </select>
                      <input name={`line${index}Amount`} defaultValue={amount} className="rounded-md border border-line bg-background px-3 py-2 text-sm" />
                    </div>
                  );
                })}
                <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">Save draft changes</button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
