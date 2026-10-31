import "server-only";
import { emailEnabled, sendPartyInvite } from "@/lib/email";
import type { Party } from "@/lib/parties";

const site = () => process.env.WEB_URL || "https://e-cinema.net";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Emails the people a host just added. At most 20 per request so a party cannot be used to spam.
export async function inviteByEmail(party: Party, host: string, emails: string[]): Promise<number> {
  if (!emailEnabled || !party?.code) return 0;
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e)))].slice(0, 20);
  const when = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(party.startsAt));
  const results = await Promise.allSettled(list.map((to) => sendPartyInvite(to, host, party.name, party.film, when, `${site()}/p/${party.code}`)));
  return results.filter((r) => r.status === "fulfilled").length;
}
