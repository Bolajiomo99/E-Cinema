"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { PlanId } from "@/lib/plans";

// Wraps a plan card on the landing page. Signed out: sign-up opens with this plan chosen.
// Signed in: the plan is recorded and Pay opens straight away (Free just goes home).
export default function PlanPickLink({ plan, signedIn, className, children }: { plan: PlanId; signedIn: boolean; className?: string; children: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const href = signedIn ? `/join?step=3&plan=${plan}` : plan === "free" ? "/join" : `/join?plan=${plan}`;
  return (
    <a
      href={href}
      className={`${className ?? ""}${busy ? " busy" : ""}`}
      aria-busy={busy}
      onClick={async (e) => {
        if (!signedIn || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        if (plan === "free") return router.push("/plans");
        setBusy(true);
        const r = await fetch("/api/me/plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }) }).catch(() => null);
        router.push(r?.ok ? `/join?step=4&plan=${plan}` : href);
      }}
    >
      {children}
    </a>
  );
}
