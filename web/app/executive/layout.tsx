import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import ExecShell from "@/components/exec/ExecShell";
import { currentAccount } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { execMe } from "@/lib/exec";

// The executive area: only people the API knows as executives get the shell.
export const dynamic = "force-dynamic";
export const metadata = { title: "Executive · E-Cinema", robots: { index: false } };

export default async function Executive({ children }: { children: ReactNode }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=%2Fexecutive");
  const who = await execMe(await session());
  const role = who === null ? null : who.role;
  if (!who || !role) {
    return (
      <main className="exs-none">
        <h1>{role === null ? "The executive area is not reachable just now" : "Executives only"}</h1>
        <p>{role === null ? "Try again in a minute." : "This part of E-Cinema is for the company's leadership. If you should have access, ask the CEO to add you under Access and roles."}</p>
        <Link href="/home" className="exs-back">Back to E-Cinema</Link>
      </main>
    );
  }
  return <ExecShell name={me.name} role={role} money={who.money}>{children}</ExecShell>;
}
