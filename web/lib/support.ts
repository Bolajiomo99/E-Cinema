import "server-only";
import { accountApi } from "@/lib/auth";

// The support inbox (gap list item 10). People write to the team from Help or through the AI
// concierge; staff answer on /support/desk; each answer is emailed with a private link.
export const TOPICS = [
  { id: "payments", label: "Payments and refunds" },
  { id: "playback", label: "Playback and buffering" },
  { id: "languages", label: "Languages and dubbing" },
  { id: "account", label: "Account and security" },
  { id: "kids", label: "Kids and parental" },
  { id: "country", label: "Country and prices" },
] as const;
export type Topic = (typeof TOPICS)[number]["id"] | "other";
export const topicLabel = (t: string) => TOPICS.find((x) => x.id === t)?.label ?? "Something else";

export type SupportMessage = { staff: boolean; body: string; at: string };
export type SupportRequest = {
  id: number; token?: string; email: string; name: string; topic: string; subject: string; status: "open" | "answered" | "closed";
  via: string; lang: string; assignee: string; member: boolean; createdAt: string; updatedAt: string; last: string; lastStaff: boolean;
  messages?: SupportMessage[];
};
export type NewRequest = { accountId?: string; email: string; name?: string; topic: string; subject: string; body: string; via?: "form" | "concierge"; lang?: string };

export async function openRequest(n: NewRequest): Promise<{ ok: true; request: SupportRequest } | { ok: false; status: number; error: string }> {
  const r = await accountApi("POST", "/v1/support", n);
  if (r.status === 200) return { ok: true, request: r.body as SupportRequest };
  return { ok: false, status: r.status, error: (r.body as { error?: string } | null)?.error ?? "We could not send that. Please try again." };
}

const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;
export async function requestByToken(token: string): Promise<SupportRequest | null> {
  if (!TOKEN.test(token)) return null;
  const r = await accountApi("GET", `/v1/support/t/${token}`);
  return r.status === 200 ? (r.body as SupportRequest) : null;
}

export async function replyByToken(token: string, body: string) {
  if (!TOKEN.test(token)) return { status: 404, body: { error: "We could not find that request" } };
  return accountApi("POST", `/v1/support/t/${token}/reply`, { body });
}

export async function myRequests(session: string): Promise<SupportRequest[]> {
  const r = await accountApi("GET", "/v1/me/support", undefined, session);
  return r.status === 200 ? ((r.body as { requests: SupportRequest[] }).requests ?? []) : [];
}

export type Desk = { requests: SupportRequest[]; counts: Record<string, number>; oldestMins: number };
export async function desk(status: string): Promise<Desk | null> {
  const r = await accountApi("GET", `/v1/support/desk?status=${encodeURIComponent(status)}`);
  return r.status === 200 ? (r.body as Desk) : null;
}
export async function deskThread(id: number): Promise<SupportRequest | null> {
  const r = await accountApi("GET", `/v1/support/desk/${id}`);
  return r.status === 200 ? (r.body as SupportRequest) : null;
}
export async function answer(id: number, staff: string, body: string, close: boolean) {
  return accountApi("POST", `/v1/support/desk/${id}`, { staff, body, close });
}

// A small per-IP limit on new requests, on top of the API's per-email limit.
const g = globalThis as unknown as { __ecSupport?: Map<string, number[]> };
const hits = (g.__ecSupport ??= new Map<string, number[]>());
export function allowNew(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length >= 10) return false;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return true;
}
