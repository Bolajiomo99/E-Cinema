"use client";
export default function PrintButton({ label, className = "vf-btn soft" }: { label: string; className?: string }) {
  return <button className={className} onClick={() => { document.querySelectorAll("details.lg-more").forEach((d) => ((d as HTMLDetailsElement).open = true)); window.print(); }}>{label}</button>;
}
