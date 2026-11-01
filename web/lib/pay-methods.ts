import type { Method } from "@/components/checkout/Methods";

// Payment methods by buyer country, shared by Checkout (18:533) and Payment failed (96:1254).
// Card payments run through PayPal's checkout; local providers switch on when their keys land.
export function methodsFor(country: string | undefined, paypal: boolean): Method[] {
  const base: Method[] = [
    { id: "paypal", name: "PayPal", sub: "PayPal balance, card or Pay Later · billed in USD", ready: paypal, icon: "paypal" },
    { id: "card", name: "Debit or credit card", sub: country === "NG" ? "Mastercard, Visa, Verve · through PayPal, no account needed" : "Mastercard, Visa · through PayPal, no account needed", ready: paypal, icon: "card" },
  ];
  const local: Method[] =
    country === "NG"
      ? [
          { id: "paystack", name: "Paystack", sub: "Card, bank, USSD or transfer", ready: false, icon: "phone" },
          { id: "flutterwave", name: "Flutterwave", sub: "Card, bank, mobile money", ready: false, icon: "phone" },
          { id: "bank", name: "Bank transfer", sub: "Pay to a one-time account number", ready: false, icon: "bank" },
        ]
      : country === "KE" || country === "GH" || country === "UG" || country === "TZ"
        ? [{ id: "flutterwave", name: "Flutterwave", sub: "Card, bank, mobile money", ready: false, icon: "phone" }]
        : [];
  return [...base, ...local, { id: "crypto", name: "Crypto", sub: "Bitcoin, USDC, Ethereum · confirmed on-chain", ready: false, icon: "crypto" }];
}

// "Try another way" after a failed payment: the card that failed is not offered again here.
export function fallbacksFor(country: string | undefined, paypal: boolean): { id: string; name: string; ready: boolean }[] {
  const local =
    country === "NG"
      ? [
          { id: "paystack", name: "Bank transfer (Paystack)", ready: false },
          { id: "ussd", name: "USSD *737#", ready: false },
          { id: "wallet", name: "Opay or PalmPay wallet", ready: false },
        ]
      : country === "KE" || country === "GH" || country === "UG" || country === "TZ"
        ? [{ id: "flutterwave", name: "Mobile money (Flutterwave)", ready: false }]
        : [];
  return [{ id: "paypal", name: "PayPal", ready: paypal }, ...local, { id: "crypto", name: "Crypto (Bitcoin, USDC)", ready: false }];
}
