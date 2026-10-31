import { showtimes } from "@/lib/catalog";
import PayPalTicketButton from "@/components/PayPalTicketButton";

export const metadata = { title: "Tickets · E-Cinema" };

export default function CheckoutPage() {
  return (
    <section className="checkout">
      <h1>Book a seat</h1>
      <ul>
        {showtimes.map((s) => (
          <li key={s.id} className="showtime">
            <div>
              <strong>{s.film}</strong>
              <span>{s.studio}</span>
              <time dateTime={s.startsAt}>{new Date(s.startsAt).toUTCString().slice(0, 22)} GMT</time>
            </div>
            <div className="buy">
              <span className="price">{s.price.currency} {s.price.value}</span>
              <PayPalTicketButton showtimeId={s.id} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
