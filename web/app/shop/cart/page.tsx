import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import CartApp from "@/components/store/CartApp";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { countryName } from "@/lib/plans";
import { myQuote, pricing } from "@/lib/store";
import { providerReady } from "@/lib/local-pay";
import { refreshPlatform } from "@/lib/platform";

// Built from the Figma frame "Web / Cart and checkout" (53:1111).
export const dynamic = "force-dynamic";
export const metadata = { title: "Cart · E-Cinema shop" };

const FAILED: Record<string, string> = {
  cancelled: "You left the payment page before paying. Your cart is still here.",
  declined: "The payment did not go through. Nothing was taken; try again or pick another way to pay.",
};

export default async function CartPage({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  const sp = await searchParams;
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/shop/cart");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const loc = await readLocale();
  const [q, px] = await Promise.all([myQuote(session, loc.country), pricing(loc.country), refreshPlatform()]);
  const country = loc.country ?? q?.address?.country;
  return (
    <DashShell>
      <div className="lp sh">
        <TopNav me={me} active="shop" t={loc.t} country={loc.country} lang={loc.lang} />
        <main className="ct">
          {q ? (
            <CartApp initial={q} px={px} country={country} countryLabel={countryName(country) || "your country"} paypal={Boolean(process.env.PAYPAL_CLIENT_ID)}
              paystack={providerReady("paystack")} flutterwave={providerReady("flutterwave")}
              failed={sp.failed ? FAILED[sp.failed] ?? "The payment did not go through. Nothing was taken; try again." : ""}
              tz={country === "NG" || !country ? "Africa/Lagos" : "UTC"} />
          ) : (
            <p className="sh-empty">Your cart could not be loaded. Refresh in a moment.</p>
          )}
        </main>
      </div>
    </DashShell>
  );
}
