"use client";

import { useState } from "react";
import AddToCart from "@/components/store/AddToCart";
import type { Option } from "@/lib/store-types";

// Option chips (colour, size, storage, flavour) and the two buttons on the product page.
export default function ProductBuy({ productId, options, signedIn }: { productId: string; options: Option[]; signedIn: boolean }) {
  const [pick, setPick] = useState(options.map((o) => o.values[0]));
  const variant = pick.join(" · ");
  return (
    <>
      {options.map((o, i) => (
        <div key={o.name} className="pd-opt">
          <p className="pd-label" id={`opt-${i}`}>{o.name}</p>
          <div className="sh-chips" role="radiogroup" aria-labelledby={`opt-${i}`}>
            {o.values.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={pick[i] === v} className={`sh-chip${pick[i] === v ? " on" : ""}`}
                onClick={() => setPick((p) => p.map((x, j) => (j === i ? v : x)))}>{v}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="pd-b">
        <AddToCart productId={productId} variant={variant} className="sh-btn" signedIn={signedIn} />
        <AddToCart productId={productId} variant={variant} className="sh-btn sec" label="Buy now" then="cart" signedIn={signedIn} />
      </div>
    </>
  );
}
