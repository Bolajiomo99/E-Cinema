"use client";

// "Export PDF": the browser's print dialog, with a print stylesheet that keeps only the report.
export default function PrintButton() {
  return <button type="button" className="in-export" onClick={() => window.print()}>Export PDF</button>;
}
