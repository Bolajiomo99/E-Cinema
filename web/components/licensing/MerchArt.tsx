import QRCode from "qrcode";
import ProductArt from "@/components/store/ProductArt";

// The hero picture on the licensing page: official merch with its QR label and hologram,
// drawn rather than a stock photo.
export default async function MerchArt() {
  // A sample label: scanning it opens the product checker.
  const qr = await QRCode.toString("https://e-cinema.net/verify", { type: "svg", margin: 1, color: { dark: "#0a0a0c", light: "#ffffff" } });
  return (
    <div className="li-art" role="img" aria-label="Official E-Cinema merch with QR labels">
      <ProductArt id="logo-tshirt" name="" className="li-art-a" size={120} />
      <ProductArt id="premiere-cap" name="" className="li-art-b" size={70} />
      <ProductArt id="premiere-hoodie" name="" className="li-art-c" size={70} />
      <div className="li-tag">
        <span className="li-qr" dangerouslySetInnerHTML={{ __html: qr }} />
        <div><b>Sample label</b><span>Each item gets its own code</span></div>
        <i className="li-holo" aria-hidden />
      </div>
    </div>
  );
}
