import type { Metadata } from "next";
import "@bryntum/calendar/fontawesome/css/fontawesome.css";
import "@bryntum/calendar/fontawesome/css/solid.css";
import "@bryntum/calendar/calendar.css";
import "@bryntum/calendar/svalbard-dark.css";
import "./fonts.css";
import "./globals.css";
import { cookies } from "next/headers";
import TabBar from "@/components/mobile/TabBar";
import { SESSION_COOKIE } from "@/lib/auth";
import { dirOf, isLang } from "@/lib/i18n";
import { LANG_COOKIE } from "@/lib/locale";

export const metadata: Metadata = {
  title: "E-Cinema",
  description: "Watch new film releases live, together, anywhere in the world.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jar = await cookies();
  const raw = jar.get(LANG_COOKIE)?.value;
  const lang = isLang(raw) ? raw : "en";
  return (
    <html lang={lang} dir={dirOf(lang)}>
      <body>
        {children}
        <TabBar signedIn={Boolean(jar.get(SESSION_COOKIE))} />
      </body>
    </html>
  );
}
