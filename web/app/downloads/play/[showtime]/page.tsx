import { notFound } from "next/navigation";
import OfflinePlayer from "@/components/downloads/OfflinePlayer";

// Plays a download sealed on this device (Figma 31:743). Works offline once the page is cached.
export const metadata = { title: "Downloads · E-Cinema", robots: { index: false } };

export default async function OfflinePlay({ params }: { params: Promise<{ showtime: string }> }) {
  const { showtime } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(showtime)) notFound();
  return <OfflinePlayer id={showtime} />;
}
