"use server";

import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { passwordCopy, type PasswordFormState } from "@/lib/password-state";
import { readAuthConfig } from "@/server/auth/config";
import { authDefaults, sessionCookieName } from "@/server/auth/constants";
import { originsMatch } from "@/server/auth/http";
import { changePassword } from "@/server/auth/login";
import { getDb } from "@/server/db/runtime";

export async function changePasswordAction(
  _previous: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const nextPassword = String(formData.get("nextPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (
    currentPassword.length > authDefaults.passwordMaxLength ||
    nextPassword.length > authDefaults.passwordMaxLength ||
    confirmPassword.length > authDefaults.passwordMaxLength
  ) {
    return { status: "validation", message: passwordCopy.rejected };
  }

  const headerList = await headers();
  if (!originsMatch(headerList.get("origin"), headerList.get("host"))) {
    return { status: "validation", message: passwordCopy.rejected };
  }
  const config = readAuthConfig(process.env);
  if (!config) return { status: "unavailable", message: passwordCopy.unavailable };

  let result: Awaited<ReturnType<typeof changePassword>>;
  try {
    const jar = await cookies();
    result = await changePassword(
      { db: getDb(config.databaseUrl), now: () => new Date() },
      {
        token: jar.get(sessionCookieName)?.value ?? null,
        currentPassword,
        nextPassword,
        confirmPassword,
      },
    );
  } catch {
    return { status: "unavailable", message: passwordCopy.unavailable };
  }

  if (result.status === "changed") redirect("/owner-private");
  if (result.status === "invalid") return { status: "invalid", message: passwordCopy.invalid };
  if (result.status === "unauthenticated") return { status: "unauthenticated", message: passwordCopy.unauthenticated };
  return { status: "validation", message: passwordCopy.validation };
}
