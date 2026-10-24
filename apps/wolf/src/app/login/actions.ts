"use server";

import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signInCopy, type SignInFormState } from "@/lib/sign-in-state";
import { readAuthConfig } from "@/server/auth/config";
import { authDefaults, sessionCookieName } from "@/server/auth/constants";
import { normalizeEmail } from "@/server/auth/crypto";
import { clientIpFromHeaders, originsMatch, sessionCookieOptions } from "@/server/auth/http";
import { loginWithPassword } from "@/server/auth/login";
import { revokeSession } from "@/server/auth/session";
import { getDb } from "@/server/db/runtime";

async function sameOrigin(): Promise<boolean> {
  const headerList = await headers();
  return originsMatch(headerList.get("origin"), headerList.get("host"));
}

function unavailable(email = ""): SignInFormState {
  return { status: "unavailable", message: signInCopy.unavailable, email };
}

export async function signInAction(_previous: SignInFormState, formData: FormData): Promise<SignInFormState> {
  const submitted = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (submitted.length > 320 || password.length > authDefaults.passwordMaxLength) {
    return { status: "validation", message: signInCopy.rejected, email: "" };
  }
  if (!(await sameOrigin())) {
    return { status: "validation", message: signInCopy.rejected, email: "" };
  }
  const email = normalizeEmail(submitted) ?? "";
  if (!email) return { status: "validation", message: signInCopy.emailInvalid, email: "" };
  if (password.length === 0) return { status: "validation", message: signInCopy.passwordInvalid, email };

  const config = readAuthConfig(process.env);
  if (!config) return unavailable(email);

  let result: Awaited<ReturnType<typeof loginWithPassword>>;
  try {
    const headerList = await headers();
    result = await loginWithPassword(
      { db: getDb(config.databaseUrl), now: () => new Date() },
      { email: submitted, password, ip: clientIpFromHeaders(headerList) },
    );
  } catch {
    return unavailable(email);
  }

  if (result.status === "verified") {
    const jar = await cookies();
    jar.set(sessionCookieName, result.sessionToken, sessionCookieOptions(result.expiresAt, config.cookieSecure));
    redirect(result.mustChangePassword ? "/account/password" : "/owner-private");
  }
  if (result.status === "rate_limited") return { status: "rate_limited", message: signInCopy.rateLimited, email };
  if (result.status === "validation") return { status: "validation", message: signInCopy.emailInvalid, email: "" };
  return { status: "invalid", message: signInCopy.invalid, email };
}

export async function logoutAction(): Promise<void> {
  await connection();
  const headerList = await headers();
  const jar = await cookies();
  if (!originsMatch(headerList.get("origin"), headerList.get("host"))) redirect("/login");

  const config = readAuthConfig(process.env);
  const token = jar.get(sessionCookieName)?.value ?? null;
  if (config && token) {
    try {
      await revokeSession(getDb(config.databaseUrl), token, new Date());
    } catch {
      // The cookie is cleared even when the local database cannot be reached.
    }
  }
  jar.set(sessionCookieName, "", { ...sessionCookieOptions(new Date(0), config?.cookieSecure ?? false), maxAge: 0 });
  redirect("/login");
}
