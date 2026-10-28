/** Companies omitted from operator-facing pickers. The company row can remain. */
const hiddenOperatorCompanyIds = new Set(["local-books"]);

export function visibleOperatorCompanyId(companyId: string): boolean {
  return !hiddenOperatorCompanyIds.has(companyId);
}

export function visibleOperatorCompanyIds(companyIds: readonly string[]): string[] {
  return companyIds.filter(visibleOperatorCompanyId);
}
