import type { NextRequest } from "next/server";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import { json } from "@/lib/room-gate";

// Nigerian banks and account-name lookups through Paystack, for the add recipient form.
// GET ?list=1 lists banks; GET ?bank=<code>&account=<10 digits> returns the account name.
// CEO only: the recipients endpoint answers 200 only for the CEO.
const key = () => process.env.PAYSTACK_SECRET_KEY ?? "";

export async function GET(req: NextRequest) {
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const me = await accountApi("GET", "/v1/me/exec/recipients", undefined, s);
  if (me.status !== 200) return json(403, { error: "forbidden" });
  if (!key()) return json(503, { error: "Bank lookups are not switched on" });
  const q = req.nextUrl.searchParams;
  const auth = { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(15000) };
  try {
    if (q.get("list")) {
      const r = await fetch("https://api.paystack.co/bank?country=nigeria&perPage=200", auth);
      const b = (await r.json()) as { data?: { name: string; code: string }[] };
      if (!r.ok) return json(502, { error: "Could not load banks" });
      return json(200, { banks: (b.data ?? []).map((x) => ({ name: x.name, code: x.code })) });
    }
    const bank = q.get("bank") ?? "";
    const account = (q.get("account") ?? "").replace(/\s/g, "");
    if (!/^[0-9A-Za-z]{2,12}$/.test(bank) || !/^[0-9]{10}$/.test(account)) return json(400, { error: "Pick a bank and enter the 10-digit account number" });
    const r = await fetch(`https://api.paystack.co/bank/resolve?account_number=${account}&bank_code=${encodeURIComponent(bank)}`, auth);
    const b = (await r.json()) as { data?: { account_name?: string } };
    if (!r.ok || !b.data?.account_name) return json(404, { error: "The bank did not recognise that account" });
    return json(200, { accountName: b.data.account_name });
  } catch {
    return json(502, { error: "The bank lookup did not answer. Try again." });
  }
}
