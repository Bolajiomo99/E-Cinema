import StudioNotices, { type NoticeData } from "@/components/studio/StudioNotices";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";

// Figma "Studio / Notifications" (99:552).
export const metadata = { title: "Notifications · Studio · E-Cinema", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function StudioNotificationsPage() {
  const s = await session();
  const [, data] = await Promise.all([myStudio(s), studioPage<NoticeData>(s, "notices")]);
  return <StudioNotices initial={data ?? { notices: [], seenAt: null, unread: 0, action: 0 }} failed={!data} />;
}
