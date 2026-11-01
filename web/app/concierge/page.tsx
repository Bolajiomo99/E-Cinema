import Concierge from "@/components/Concierge";

export const metadata = { title: "Concierge · E-Cinema" };

// ?ask= fills in the first question (from "Shop the film" in the watch room); the viewer still sends it.
export default async function ConciergePage({ searchParams }: { searchParams: Promise<{ ask?: string }> }) {
  const { ask } = await searchParams;
  return <Concierge ask={typeof ask === "string" ? ask : ""} />;
}
