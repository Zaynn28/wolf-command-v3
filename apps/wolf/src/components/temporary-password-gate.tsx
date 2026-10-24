import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { readSignedInAccount } from "@/server/auth/current-session";

const openPaths = new Set(["/login", "/account/password"]);

export async function TemporaryPasswordGate({ children }: { children: ReactNode }) {
  await connection();
  const path = (await headers()).get("x-wolf-path") ?? "";
  if (openPaths.has(path)) return children;
  const account = await readSignedInAccount();
  if (account?.mustChangePassword) redirect("/account/password");
  return children;
}
