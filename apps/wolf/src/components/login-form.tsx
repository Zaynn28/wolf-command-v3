"use client";

import { useActionState, useState } from "react";
import { signInAction } from "@/app/login/actions";
import { SubmitButton } from "@/components/submit-button";
import { initialSignInState, signInCopy } from "@/lib/sign-in-state";

export function LoginForm() {
  const [state, formAction] = useActionState(signInAction, initialSignInState);
  const [email, setEmail] = useState(state.email);
  const [trackedEmail, setTrackedEmail] = useState(state.email);
  if (state.email !== trackedEmail) {
    setTrackedEmail(state.email);
    setEmail(state.email);
  }

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      {state.message ? (
        <p role="alert" className="text-sm leading-6 text-foreground">
          {state.message}
        </p>
      ) : null}
      <label htmlFor="email" className="text-sm font-medium">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        maxLength={254}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        aria-invalid={state.status === "validation" && state.message === signInCopy.emailInvalid}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground"
      />
      <label htmlFor="password" className="text-sm font-medium">
        Wolf password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        maxLength={128}
        aria-invalid={state.status === "invalid"}
        className="rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground"
      />
      <p className="text-sm leading-6 text-muted">
        Use the password created for Wolf. Do not enter the password for your email account.
      </p>
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
