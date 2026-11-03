import { session } from "@/lib/licensing";
import { execSettings } from "@/lib/exec";
import { methodsFor } from "@/lib/pay-methods";
import { currencyFor } from "@/lib/plans";
import ExecSettings from "@/components/exec/ExecSettings";

export const metadata = { title: "Settings · Executive · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

// Executive settings (Figma 83:386): platform switches the CEO changes, with an audit log.
export default async function SettingsPage() {
  const d = await execSettings(await session());
  if (!d) return <section className="exc"><h1>Settings</h1><p className="exc-sub">Only the CEO can open this page.</p></section>;
  const on = (k: string) => d.values[k] !== false;
  const keys = { paypal: on("pay.paypal") && Boolean(process.env.PAYPAL_CLIENT_ID), paystack: on("pay.paystack") && Boolean(process.env.PAYSTACK_SECRET_KEY), flutterwave: on("pay.flutterwave") && Boolean(process.env.FLUTTERWAVE_SECRET_KEY) };
  const countries = d.countries.map((c) => ({
    ...c, currency: currencyFor(c.country),
    methods: [...new Set(methodsFor(c.country, keys.paypal, keys).filter((m) => m.ready).map((m) => (m.id === "card" ? "Cards" : m.name)))],
  }));
  const configured = { paypal: Boolean(process.env.PAYPAL_CLIENT_ID), paystack: Boolean(process.env.PAYSTACK_SECRET_KEY), flutterwave: Boolean(process.env.FLUTTERWAVE_SECRET_KEY), live: process.env.PAYPAL_ENV === "live" };
  return <ExecSettings d={d} countries={countries} configured={configured} />;
}
