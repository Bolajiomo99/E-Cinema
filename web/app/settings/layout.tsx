import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/auth";
import SettingsNav from "@/components/settings/SettingsNav";

export const dynamic = "force-dynamic";

// Every settings page needs a signed-in viewer.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  if (!(await currentAccount())) redirect("/signin?next=/settings/account");
  return (
    <div className="st">
      <SettingsNav />
      <main id="main" className="st-main">{children}</main>
    </div>
  );
}
