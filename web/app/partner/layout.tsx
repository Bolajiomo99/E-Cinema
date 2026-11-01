import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import PartnerShell from "@/components/licensing/PartnerShell";
import { currentAccount } from "@/lib/auth";
import { myLicence, session } from "@/lib/licensing";

// The licensed partner portal (Figma 116:192 to 116:726). Only owners and staff of a licence get in.
export const dynamic = "force-dynamic";
export const metadata = { title: "Partner dashboard · E-Cinema", robots: { index: false } };

export default async function PartnerLayout({ children }: { children: ReactNode }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=%2Fpartner");
  const mine = await myLicence(await session());
  if (!mine) redirect("/licensing/apply");
  return <PartnerShell licensee={mine.licensee}>{children}</PartnerShell>;
}
