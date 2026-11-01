import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import CartApp from "@/components/store/CartApp";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { countryName } from "@/lib/plans";
import { myQuote, pricing } from "@/lib/store";

// Built from the Figma frame "Web / Cart and checkout" (53:1111).
export const dynamic = "force-dynamic";
export const metadata = { title: "Cart · E-Cinema shop" };

export default async function CartPage() {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/shop/cart");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const loc = await readLocale();
  const [q, px] = await Promise.all([myQuote(session, loc.country), pricing(loc.country)]);
  const country = loc.country ?? q?.address?.country;
  return (
    <DashShell>
      <div className="lp sh">
        <TopNav me={me} active="shop" t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="ct">
          {q ? (
            <CartApp initial={q} px={px} country={country} countryLabel={countryName(country) || "your country"} paypal={Boolean(process.env.PAYPAL_CLIENT_ID)}
              tz={country === "NG" || !country ? "Africa/Lagos" : "UTC"} />
          ) : (
            <p className="sh-empty">Your cart could not be loaded. Refresh in a moment.</p>
          )}
        </main>
      </div>
    </DashShell>
  );
}
