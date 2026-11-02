import StudioAI from "@/components/studio/StudioAI";

// Figma "Studio / Studio AI" (39:1345).
export const metadata = { title: "Studio AI · Studio · E-Cinema", robots: { index: false } };

export default async function StudioAIPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <StudioAI ask={typeof q === "string" ? q.slice(0, 500) : ""} />;
}
