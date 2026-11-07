import StudioSettings from "@/components/studio/StudioSettings";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";

// Figma "Studio / Settings" (39:1184).
export const metadata = { title: "Settings · Studio · E-Cinema", robots: { index: false } };

export default async function StudioSettingsPage() {
  const s = await session();
  const [mine, a] = await Promise.all([myStudio(s), studioPage<{ alerts: string[] }>(s, "alerts")]);
  return mine?.studio ? <StudioSettings studio={mine.studio} alerts={a?.alerts ?? null} /> : null;
}
