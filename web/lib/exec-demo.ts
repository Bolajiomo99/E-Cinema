// Demo data for the PayPal and agents dashboard until the database exists.
// Shape matches what the ledger will return, so only the source changes later.
export type LedgerRow = {
  film: string;
  studio: string;
  country: string;
  product: "Checkout" | "Pay Later" | "Subscriptions" | "Vault (concierge)" | "Donations";
  tickets: number;
  grossUsd: number;
  refundsUsd: number;
  disputes: number;
  viaAgent: boolean;
};

const films = [
  ["Red Earth", "Lagoon Gate Pictures"],
  ["Seoul After Rain", "Hanbit Story House"],
  ["Lagos Lights", "Lagoon Gate Pictures"],
  ["Paper Moon Riders", "Kumo Frame Studio"],
  ["The Last Glacier", "Northlight Docs"],
] as const;
const countries = ["Nigeria", "Ghana", "Kenya", "United Kingdom", "United States", "South Korea", "Brazil"];
const products: LedgerRow["product"][] = ["Checkout", "Pay Later", "Subscriptions", "Vault (concierge)", "Donations"];

// Deterministic so the server and browser render the same numbers.
function rand(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export const ledger: LedgerRow[] = films.flatMap(([film, studio], f) =>
  countries.flatMap((country, c) =>
    products.map((product, p) => {
      const r = rand(f * 100 + c * 10 + p + 1);
      const tickets = Math.round(40 + r * 900);
      const grossUsd = Math.round(tickets * (5.49 + r * 1.5) * 100) / 100;
      return {
        film,
        studio,
        country,
        product,
        tickets,
        grossUsd,
        refundsUsd: Math.round(grossUsd * r * 0.03 * 100) / 100,
        disputes: r > 0.93 ? 1 : 0,
        viaAgent: product === "Vault (concierge)" || r > 0.6,
      };
    }),
  ),
);
