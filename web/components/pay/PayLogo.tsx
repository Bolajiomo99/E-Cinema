/* eslint-disable @next/next/no-img-element */
// Real brand marks for payment choices, so buyers spot the method they know at a glance.
// Files live in /public/pay (PayPal, Visa, Mastercard from the CC0 "logos" set; Paystack, Verve
// and Flutterwave from the providers' own plugin repositories; Coinbase from Simple Icons).
export type PayBrand = "paypal" | "card" | "card-ng" | "paystack" | "flutterwave" | "coinbase" | "cash" | "bank";

const img = (src: string, alt: string, h: number) => <img key={src} src={src} alt={alt} height={h} style={{ height: h, width: "auto" }} />;

export default function PayLogo({ brand }: { brand: PayBrand }) {
  switch (brand) {
    case "paypal":
      return <span className="pay-logo">{img("/pay/paypal.svg", "PayPal", 22)}</span>;
    case "card":
      return <span className="pay-logo">{img("/pay/visa.svg", "Visa", 10)}{img("/pay/mastercard.svg", "Mastercard", 16)}</span>;
    case "card-ng":
      return <span className="pay-logo">{img("/pay/verve.png", "Verve", 13)}{img("/pay/visa.svg", "Visa", 9)}{img("/pay/mastercard.svg", "Mastercard", 15)}</span>;
    case "paystack":
      return <span className="pay-logo">{img("/pay/paystack.png", "Paystack", 13)}</span>;
    case "flutterwave":
      return <span className="pay-logo">{img("/pay/flutterwave-mark.svg", "", 16)}{img("/pay/flutterwave-wordmark.png", "Flutterwave", 11)}</span>;
    case "coinbase":
      return <span className="pay-logo">{img("/pay/coinbase.svg", "Coinbase", 12)}</span>;
    case "bank":
      return <span className="pay-logo icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0a0a0c" strokeWidth="1.8" aria-hidden><path d="M3 9.5 12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" /></svg></span>;
    default:
      return <span className="pay-logo icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0a0a0c" strokeWidth="1.8" aria-hidden><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v5M18 9.5v5" /></svg></span>;
  }
}
