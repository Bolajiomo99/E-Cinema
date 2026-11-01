// Brand protection types shared by the pages and the browser (Figma 114:1670, 114:1733, 114:1751, 114:1818).
export type Licensee = { licence: string; name: string; city: string; country: string; website: string; status: string };

export type Check = {
  code: string;
  genuine: boolean;
  reason: "ok" | "never" | "copied" | "ended" | "bad";
  first: boolean;
  scans: number;
  places: number;
  firstAt?: string;
  product?: string;
  licensee?: Licensee;
};

export type Place = "online" | "social" | "market" | "delivered";
export const PLACES: [Place, string][] = [["online", "Online shop"], ["social", "Social media"], ["market", "Market or shop"], ["delivered", "Delivered to me"]];

export type Report = {
  id: string;
  place: Place;
  link: string;
  selling: string;
  code?: string;
  photos: string[];
  aiNote: string;
  anonymous: boolean;
  status: "sent" | "checking" | "confirmed" | "rejected" | "false";
  outcome: string;
  rewardNgn: number;
  points: number;
  createdAt: string;
  decidedAt?: string;
  reporter?: string;
  country?: string;
};

export type Rewards = {
  points: number;
  monthPoints: number;
  sent: number;
  confirmed: number;
  rewardNgn: number;
  rank: number;
  country: string;
  reports: Report[];
  top: { name: string; points: number; me: boolean }[];
};

export const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

// The pill on each report row: words and colour (Figma 114:1670).
export function reportPill(r: Report): { text: string; tone: "teal" | "amber" | "grey" | "red" } {
  switch (r.status) {
    case "confirmed":
      return { text: `Confirmed · ${r.outcome || "taken down"}`, tone: "teal" };
    case "checking":
      return { text: "Investigator visiting", tone: "amber" };
    case "sent":
      return { text: "Sent · being checked", tone: "amber" };
    case "false":
      return { text: "Found untrue", tone: "red" };
    default:
      return { text: "Not enough proof", tone: "grey" };
  }
}

// Where the report was seen, for the "Where" column: the platform or the place.
export function where(r: Report): string {
  const host = r.link.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0].toLowerCase();
  const named: Record<string, string> = { "instagram.com": "Instagram", "facebook.com": "Facebook", "tiktok.com": "TikTok", "x.com": "X", "twitter.com": "X", "jiji.ng": "Jiji.ng", "jumia.com.ng": "Jumia", "wa.me": "WhatsApp", "chat.whatsapp.com": "WhatsApp" };
  if (named[host]) return named[host];
  if (/whatsapp/i.test(r.link)) return "WhatsApp";
  if (r.place === "market" || r.place === "delivered") return r.link.split(",").pop()!.trim().slice(0, 24);
  return host.includes(".") ? host : r.link.slice(0, 24);
}
