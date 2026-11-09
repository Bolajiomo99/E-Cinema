import type { NextRequest } from "next/server";
import { currentAccount } from "@/lib/auth";
import { isStaff } from "@/lib/store";
import { json, sameOrigin } from "@/lib/room-gate";
import { answer } from "@/lib/support";

// POST { body, close }: staff answer a request (an empty body with close only closes it).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const me = await currentAccount();
  if (!me || !isStaff(me.email)) return json(403, { error: "This desk is for E-Cinema staff." });
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return json(400, { error: "Bad request" });
  const b = (await req.json().catch(() => ({}))) as { body?: unknown; close?: unknown };
  const r = await answer(Number(id), me.email, typeof b.body === "string" ? b.body.slice(0, 5000) : "", b.close === true);
  return json(r.status, r.body ?? {});
}
