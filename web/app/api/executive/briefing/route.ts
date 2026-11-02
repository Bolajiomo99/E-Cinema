import { NextResponse } from "next/server";
import { session } from "@/lib/licensing";
import { briefing, commandCenter } from "@/lib/exec";

// GET: the AI briefing for the command center. The API refuses anyone without a command role.
export async function GET() {
  const s = await session();
  if (!s) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const p = await commandCenter(s);
  if (!p) return NextResponse.json({ error: "Executives only" }, { status: 403 });
  const d = new Date(Date.now() + 3600_000);
  const today = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  try {
    return NextResponse.json({ items: await briefing(p, today) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message === "off" ? "The AI briefing is switched off" : "The AI briefing could not be written just now" }, { status: 503 });
  }
}
