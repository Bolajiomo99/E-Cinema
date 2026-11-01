import StudioSettings from "@/components/studio/StudioSettings";
import { session } from "@/lib/licensing";
import { myStudio } from "@/lib/studio";

// Figma "Studio / Settings" (39:1184).
export const metadata = { title: "Settings · Studio · E-Cinema", robots: { index: false } };

export default async function StudioSettingsPage() {
  const mine = await myStudio(await session());
  return mine?.studio ? <StudioSettings studio={mine.studio} /> : null;
}
