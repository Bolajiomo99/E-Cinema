"use client";

import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { CellStyleModule, ClientSideRowModelModule, ModuleRegistry, NumberFilterModule, TextFilterModule, colorSchemeDark, themeQuartz } from "ag-grid-community";
import type { ColDef } from "ag-grid-community";
import { LicenseManager, RowGroupingModule, SetFilterModule, StatusBarModule } from "ag-grid-enterprise";
import type { LedgerRow } from "@/lib/exec-demo";

ModuleRegistry.registerModules([CellStyleModule, ClientSideRowModelModule, NumberFilterModule, TextFilterModule, RowGroupingModule, SetFilterModule, StatusBarModule]);
if (process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY) LicenseManager.setLicenseKey(process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY);

const theme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#16161a",
  headerBackgroundColor: "#0b0b0d",
  accentColor: "#e50914",
  fontFamily: "Manrope, sans-serif",
  borderColor: "#26262c",
});

const usd = (v: number | null | undefined) => (v == null ? "" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export default function PaymentsGrid({ rows }: { rows: LedgerRow[] }) {
  const [groupBy, setGroupBy] = useState<"film" | "product" | "country">("film");
  const columnDefs = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "film", rowGroup: groupBy === "film", hide: groupBy === "film", filter: "agSetColumnFilter" },
      { field: "studio", filter: "agSetColumnFilter" },
      { field: "country", rowGroup: groupBy === "country", hide: groupBy === "country", filter: "agSetColumnFilter" },
      { field: "product", headerName: "PayPal product", rowGroup: groupBy === "product", hide: groupBy === "product", filter: "agSetColumnFilter" },
      { field: "tickets", aggFunc: "sum", filter: "agNumberColumnFilter", type: "rightAligned" },
      { field: "grossUsd", headerName: "Gross", aggFunc: "sum", valueFormatter: (p) => usd(p.value), type: "rightAligned" },
      { field: "refundsUsd", headerName: "Refunds", aggFunc: "sum", valueFormatter: (p) => usd(p.value), type: "rightAligned" },
      { field: "disputes", aggFunc: "sum", type: "rightAligned" },
      { headerName: "Studio share (70%)", valueGetter: (p) => (p.data ? Math.round((p.data.grossUsd - p.data.refundsUsd) * 0.7 * 100) / 100 : null), aggFunc: "sum", valueFormatter: (p) => usd(p.value), type: "rightAligned" },
    ],
    [groupBy],
  );

  return (
    <div className="grid-wrap">
      <div className="grid-tools" role="group" aria-label="Group by">
        {(["film", "product", "country"] as const).map((g) => (
          <button key={g} className={g === groupBy ? "on" : ""} onClick={() => setGroupBy(g)}>
            By {g}
          </button>
        ))}
      </div>
      <div style={{ height: 520 }}>
        <AgGridReact<LedgerRow>
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ flex: 1, minWidth: 110, sortable: true, resizable: true }}
          autoGroupColumnDef={{ minWidth: 200, headerName: groupBy[0].toUpperCase() + groupBy.slice(1) }}
          groupDefaultExpanded={0}
          grandTotalRow="bottom"
          suppressAggFuncInHeader
          statusBar={{ statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent" }, { statusPanel: "agAggregationComponent" }] }}
        />
      </div>
    </div>
  );
}
