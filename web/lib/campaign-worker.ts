import "server-only";
import { sendCampaignEmails, type CampaignMail } from "@/lib/email";

// Notifications and re-engagement (Figma 51:375): every minute the API hands over campaigns whose
// time has come (already delivered in the app) and this sends their emails.
type Batch = { campaign: { id: number; link: string }; recipients: CampaignMail[] };

async function internal<T>(path: string, body: unknown = {}): Promise<{ status: number; body: T } | null> {
  const base = process.env.API_URL, token = process.env.INTERNAL_API_TOKEN;
  if (!base || !token) return null;
  const r = await fetch(`${base}${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), cache: "no-store",
  }).catch(() => null);
  if (!r) return null;
  return { status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

// Emails one batch and records how many went out.
export async function emailBatch(b: Batch) {
  if (!b.recipients?.length) return 0;
  const n = await sendCampaignEmails(b.recipients, b.campaign.link);
  if (n) await internal(`/v1/exec-campaigns/${b.campaign.id}/emailed`, { count: n });
  return n;
}

let running = false;
export async function runDueCampaigns() {
  if (running) return;
  running = true;
  try {
    const r = await internal<{ batches?: Batch[] }>("/v1/exec-campaigns/due");
    for (const b of r?.body.batches ?? []) await emailBatch(b);
  } catch (e) {
    console.error("campaigns", e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
}

export function startCampaignWorker() {
  setInterval(() => void runDueCampaigns(), 60_000).unref?.();
}
