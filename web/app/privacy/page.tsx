import SiteFooter from "@/components/SiteFooter";

export const metadata = { title: "Privacy Policy · E-Cinema" };

export default function PrivacyPage() {
  return (
    <article className="legal">
      <p className="eyebrow">Legal</p>
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated 31 October 2026</p>

      <p>
        E-Cinema is run by Online Cinema Ltd (RC 9947766), a company registered in Nigeria. This policy explains what we
        collect when you use e-cinema.net and our apps, why, and the choices you have. We never sell your personal data.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address and, if you add one, your phone number. Passwords are stored only as a one-way hash that nobody, including us, can read.</li>
        <li><strong>Sign-in details:</strong> a short label for each signed-in device (for example &ldquo;Chrome on Mac&rdquo;), when it was last used, and passkeys you add. A passkey&apos;s private part never leaves your device.</li>
        <li><strong>Identity check:</strong> when you verify your face and ID, the selfie video and document photo go straight to our verification partner, Sumsub. We keep only the result (approved, retry or rejected), not the images.</li>
        <li><strong>Tickets and payments:</strong> what you booked and the payment reference. Card and bank details are handled by PayPal; we never see or store them.</li>
        <li><strong>Sign-in with Google or Apple:</strong> if you choose it, we receive your name, email and an account identifier from that provider. We do not get your password or contacts.</li>
        <li><strong>Concierge chats:</strong> messages you send to the E-Cinema assistant, so it can answer and book for you.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To run your account, sell and honour tickets, and stream screenings to you.</li>
        <li>To keep one real person per account, limit sharing and protect films from piracy.</li>
        <li>To prevent fraud, abuse and payment problems.</li>
        <li>To send messages about your account and bookings, such as codes and receipts.</li>
      </ul>

      <h2>Who helps us</h2>
      <p>
        We use trusted providers who process data only on our instructions: Render (hosting, in Frankfurt, Germany),
        Cloudflare (network and storage), PayPal (payments), Sumsub (identity checks), Termii (text messages), Anthropic
        (the AI assistant and translations), ElevenLabs (AI voice dubbing of films, which uses film scripts, not your data)
        and Resend (email). Some of them process data outside Nigeria; we rely on their contractual safeguards when they do.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your account data while your account is open. Payment records are kept as long as tax and accounting law
        requires. Sign-in records for removed devices and expired sessions are deleted over time.
      </p>

      <h2>Your choices and rights</h2>
      <p>
        You can see and remove your signed-in devices and passkeys in Settings at any time. You can ask us for a copy of
        your data, to correct it, or to delete your account by emailing <a href="mailto:admin@e-cinema.net">admin@e-cinema.net</a>.
        These rights come from the Nigeria Data Protection Act 2023 and, where it applies, the EU and UK GDPR. You can also
        complain to the Nigeria Data Protection Commission or your local data protection authority.
      </p>

      <h2>Children</h2>
      <p>
        Children may use E-Cinema only through a parent&apos;s account with kids mode on. 18+ titles need a verified ID.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell you by email or in the app before it takes effect.</p>

      <h2>Contact</h2>
      <p>Online Cinema Ltd, trading as E-Cinema · <a href="mailto:admin@e-cinema.net">admin@e-cinema.net</a></p>
      <SiteFooter />
    </article>
  );
}
