import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import ExecShell from "@/components/exec/ExecShell";
import { currentAccount } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { execMe } from "@/lib/exec";
import { refreshPlatform, switchOn } from "@/lib/platform";

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
      <main id="main" className="exs-none">
        <h1>{role === null ? "The executive area is not reachable just now" : "Executives only"}</h1>
        <p>{role === null ? "Try again in a minute." : "This part of E-Cinema is for the company's leadership. If you should have access, ask the CEO to add you under Access and roles."}</p>
        <Link href="/home" className="exs-back">Back to E-Cinema</Link>
      </main>
    );
  }
  // Settings > "Passkey and face for every executive" (Figma 83:386).
  if (who.needsStrong) {
    return (
      <main id="main" className="exs-none">
        <h1>Add a passkey and a face check first</h1>
        <p>The CEO requires every executive to sign in with a passkey and to finish the ID and face check before opening the executive area.</p>
        <Link href="/settings/security" className="exs-back">Add a passkey</Link>{" "}
        <Link href="/settings/account" className="exs-back">Finish the face check</Link>
      </main>
    );
  }
  await refreshPlatform();
  return <ExecShell name={me.name} role={role} money={who.money} idleMinutes={switchOn("sec.timeout") ? 15 : 0}>{children}</ExecShell>;
}
