import StateCard from "@/components/states/StateCard";

export const metadata = { title: "Page not found · E-Cinema" };

export default function NotFound() {
  return (
    <StateCard icon="search" title="Page not found" action={{ label: "Go home", href: "/" }}>
      The link may be old or the premiere may have finished.
    </StateCard>
  );
}
