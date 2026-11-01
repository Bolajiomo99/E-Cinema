"use client";
export default function PrintButton() {
  return <button className="vf-btn red" onClick={() => window.print()}>Print</button>;
}
