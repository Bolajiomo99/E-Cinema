"use client";

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { CellStyleModule, ClientSideRowModelModule, ModuleRegistry, NumberFilterModule, TextFilterModule, colorSchemeDark, themeQuartz } from "ag-grid-community";
import type { ColDef } from "ag-grid-community";
import { LicenseManager, SetFilterModule } from "ag-grid-enterprise";

// Revenue by film (Figma 285:373) in AG Grid: sortable and filterable, every row from the ledger.
ModuleRegistry.registerModules([CellStyleModule, ClientSideRowModelModule, NumberFilterModule, TextFilterModule, SetFilterModule]);
if (process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY) LicenseManager.setLicenseKey(process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY);

const theme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#131317",
  headerBackgroundColor: "#131317",
  accentColor: "#e3182d",
  fontFamily: "Manrope, sans-serif",
  borderColor: "#23232b",
  wrapperBorder: false,
  headerTextColor: "#8a8a96",
});

export type FilmMoney = { film: string; studio: string; seats: number; usd: number; refundPct: number; disputes: number; payout: number };
const usd = (v: number | null | undefined) => (v == null ? "" : `$${Math.round(v).toLocaleString("en-US")}`);

export default function PaymentsGrid({ rows }: { rows: FilmMoney[] }) {
  const columnDefs = useMemo<ColDef<FilmMoney>[]>(() => [
    { field: "film", headerName: "Film", filter: "agSetColumnFilter", minWidth: 150, cellStyle: { fontWeight: 600 } },
    { field: "studio", headerName: "Studio", filter: "agSetColumnFilter", minWidth: 140 },
    { field: "seats", headerName: "Seats sold", filter: "agNumberColumnFilter", valueFormatter: (p) => (p.value ?? 0).toLocaleString("en-US") },
    { field: "usd", headerName: "PayPal revenue", sort: "desc", valueFormatter: (p) => usd(p.value) },
    { field: "refundPct", headerName: "Refunds", valueFormatter: (p) => `${(p.value ?? 0).toFixed(1)}%`, cellStyle: (p) => ((p.value ?? 0) >= 2 ? { color: "#f2b84b" } : null) },
    { field: "disputes", headerName: "Disputes" },
    { field: "payout", headerName: "Studio payout (70%)", minWidth: 160, valueFormatter: (p) => usd(p.value) },
  ], []);
  return (
    <div style={{ height: Math.min(520, 60 + Math.max(2, rows.length) * 42) }}>
      <AgGridReact<FilmMoney>
        theme={theme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ flex: 1, minWidth: 110, sortable: true, resizable: true }}
        rowHeight={42}
        overlayNoRowsTemplate="No PayPal seats sold in this period."
      />
    </div>
  );
}
