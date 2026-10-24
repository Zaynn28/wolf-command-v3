export function seedReadyOutput(accounts: readonly { email: string }[]): string {
  return [
    "Local development accounts are ready. Wolf passwords were not printed or emailed.",
    ...accounts.map((account) => account.email),
  ].join("\n");
}

export function provisionCreatedOutput(email: string): string {
  return `Account created for ${email}. Share the temporary Wolf password through an approved channel. It was not emailed.`;
}

export function provisionResetOutput(email: string): string {
  return `Temporary Wolf password set for ${email}. It was not emailed and must be changed at first sign-in.`;
}
