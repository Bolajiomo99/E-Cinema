import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import StudioShell from "@/components/studio/StudioShell";
import { currentAccount } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { myStudio } from "@/lib/studio";

// Inner studio pages: only members of a verified studio get in.
export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · E-Cinema", robots: { index: false } };

export default async function StudioPortal({ children }: { children: ReactNode }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=%2Fstudio");
  const mine = await myStudio(await session());
  if (!mine?.studio || mine.studio.status !== "verified") redirect("/studio");
  return <StudioShell studio={mine.studio}>{children}</StudioShell>;
}
