import StudioSettings from "@/components/studio/StudioSettings";
import type { Hook } from "@/components/studio/StudioWebhooks";
import { can } from "@/lib/studio-types";
import { session } from "@/lib/licensing";
import { myStudio, studioPage } from "@/lib/studio";

// Figma "Studio / Settings" (39:1184).
export const metadata = { title: "Settings · Studio · E-Cinema", robots: { index: false } };

export default async function StudioSettingsPage() {
  const s = await session();
  const [mine, a] = await Promise.all([myStudio(s), studioPage<{ alerts: string[] }>(s, "alerts")]);
  if (!mine?.studio) return null;
  const h = can(mine.studio.role, "edit") ? await studioPage<{ hooks: Hook[] }>(s, "webhooks") : null;
  return <StudioSettings studio={mine.studio} alerts={a?.alerts ?? null} hooks={h?.hooks ?? null} />;
}
