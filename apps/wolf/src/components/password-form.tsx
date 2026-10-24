"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/account/password/actions";
import { SubmitButton } from "@/components/submit-button";
import { initialPasswordState } from "@/lib/password-state";

export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialPasswordState);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      {state.message ? (
        <p role="alert" className="text-sm leading-6 text-foreground">
          {state.message}
        </p>
      ) : null}
      <label htmlFor="currentPassword" className="text-sm font-medium">
        Current Wolf password
      </label>
      <input
        id="currentPassword"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        maxLength={128}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground"
      />
      <label htmlFor="nextPassword" className="text-sm font-medium">
        New Wolf password
      </label>
      <input
        id="nextPassword"
        name="nextPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={128}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground"
      />
      <label htmlFor="confirmPassword" className="text-sm font-medium">
        Confirm new Wolf password
      </label>
      <input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={128}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground"
      />
      <p className="text-sm leading-6 text-muted">
        This changes only the Wolf password. It does not change the password for your email account.
      </p>
      <SubmitButton pendingLabel="Saving password…">Change password</SubmitButton>
    </form>
  );
}
