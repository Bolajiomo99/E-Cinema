import { currentAccount } from "@/lib/auth";
import { endsAt, showtimes } from "@/lib/catalog";
import { uptime } from "@/lib/uptime";
import { TOPICS } from "@/lib/support";
import HelpCenter from "@/components/help/HelpCenter";

export const metadata = { title: "Help · E-Cinema", description: "Ask E-Cinema AI in any language, or message a person on our team." };

// Help and AI concierge (Figma 33:987), with the support inbox (gap list item 10).
export default async function Help() {
  const [me, up] = await Promise.all([currentAccount(), uptime().catch(() => null)]);
  const now = Date.now();
  const liveRooms = showtimes.filter((s) => Date.parse(s.startsAt) <= now && endsAt(s) > now).length;
  return (
    <HelpCenter topics={TOPICS.map((t) => ({ id: t.id, label: t.label }))} status={{ up: up ? up.up : null, liveRooms }} signedIn={Boolean(me)} email={me?.email ?? ""} />
  );
}
