"use client";
import Link from "next/link";
import ProductArt from "@/components/store/ProductArt";
import type { ShopData } from "@/lib/exec";
import { countryName } from "@/lib/worldmap";

// Shop and merch (Figma 51:657). Every product carries the E-Cinema mark; naira is the shop's
// base price and buyers see their own currency.
const SHIPS: Record<string, string> = { world: "Ships worldwide", ng: "Ships in Nigeria", lagos: "Same day in Lagos", digital: "Sent by email" };
const ngn = (v: number) => `₦${Math.round(v).toLocaleString("en-NG")}`;
const k = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : v.toLocaleString("en-US"));
function usd(nairas: number, rate: number) {
  if (!rate) return ngn(nairas);
  const v = nairas / rate;
  return v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${Math.round(v / 1e3)}k` : `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
}

export default function ExecShop({ d, ngnPerUsd }: { d: ShopData; ngnPerUsd: number }) {
  const growth = d.ordersPrev ? Math.round(((d.orders - d.ordersPrev) / d.ordersPrev) * 100) : null;
  const dest = Object.entries(d.destinations).sort((a, b) => b[1] - a[1]);
  const top = d.products.filter((p) => p.active).sort((a, b) => b.revenueNgn - a.revenueNgn)[0];
  return (
    <section className="exc exs2">
      <header className="exc-head">
        <div>
          <h1>Shop and merch</h1>
          <p className="exc-sub">Every product carries the E-Cinema mark. Prices are set in naira; each buyer sees their own currency at today&apos;s rate.</p>
        </div>
        {d.canAdd ? <Link href="/executive/shop/new" className="exa-red exn-btn exs2-add">Add product</Link> : <span className="exs2-note">Ask the CEO for “Can add merch and rooms” to add products</span>}
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Orders (30 days)</span><b>{k(d.orders)}</b><small className={growth === null ? "" : growth >= 0 ? "up" : "down"}>{growth === null ? (d.orders ? "first month with orders" : "no orders yet") : `${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth)}%`}</small></div>
        <div className="exc-tile"><span>Shop revenue</span><b>{usd(d.revenueNgn, ngnPerUsd)}</b><small>{ngn(d.revenueNgn)}</small></div>
        <div className="exc-tile"><span>Avg basket</span><b>{d.orders ? usd(d.revenueNgn / d.orders, ngnPerUsd) : "–"}</b><small className="up">{top && top.sold ? `${top.name} sells most` : "no sales yet"}</small></div>
        <div className="exc-tile"><span>Delivered on time</span><b>{d.delivered ? `${Math.round((d.onTime / d.delivered) * 1000) / 10}%` : "–"}</b><small className="up">{d.delivered ? `${d.delivered} delivered · ${dest.length} countr${dest.length === 1 ? "y" : "ies"}` : "nothing delivered yet"}</small></div>
      </div>

      <div className="exc-card exl-card">
        <h2>Products</h2>
        <div className="exn-table" role="table" tabIndex={0} aria-label="Products">
          <div className="exn-th exs2-g" role="row"><span role="columnheader">Product</span><span role="columnheader">Stock</span><span role="columnheader">Sold (30 d)</span><span role="columnheader">Revenue</span><span role="columnheader">Fulfilment</span><span /></div>
          {d.products.map((p) => (
            <div key={p.id} className={`exn-tr exs2-g${p.active ? "" : " exs2-off"}`} role="row">
              <span role="cell" className="exs2-prod"><ProductArt id={p.id} name={p.name} images={p.images} size={22} className="exs2-art" /><span><b>{p.name}</b>{!p.active && <small>Draft · not in the shop</small>}{p.licence && <small>Licensee product</small>}</span></span>
              <span role="cell" className="exl-soon">Soon</span>
              <span role="cell">{k(p.sold)}</span>
              <span role="cell"><b>{usd(p.revenueNgn, ngnPerUsd)}</b></span>
              <span role="cell" className="exs2-ful">{SHIPS[p.ships] ?? p.ships}{p.beforeShow ? " · before showtime" : p.shipDays ? ` · ${p.shipDays} day${p.shipDays === 1 ? "" : "s"}` : ""}</span>
              <span role="cell">{d.canAdd && !p.licence && <Link href={`/executive/shop/${p.id}`} className="exa-edit exn-btn">Edit</Link>}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="exc-row exn-row">
        <div className="exc-card">
          <h2>Where orders went (30 days)</h2>
          {dest.length ? dest.slice(0, 8).map(([cc, n]) => <div key={cc} className="exs2-dest"><span>{countryName(cc)}</span><small>{n} order{n === 1 ? "" : "s"}</small></div>) : <p className="exc-empty">No orders in the last 30 days.</p>}
          <p className="exm-note">Orders ship from Lagos; warehouses in other regions are coming soon.</p>
        </div>
        <div className="exc-card">
          <h2>Payments in the shop</h2>
          <p className="exs2-pay">PayPal in every country PayPal serves, and cash on delivery in Nigeria. Card payments through Paystack and Flutterwave already run for tickets and come to the shop next.</p>
        </div>
      </div>
    </section>
  );
}
