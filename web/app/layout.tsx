import type { Metadata } from "next";
import "@bryntum/calendar/fontawesome/css/fontawesome.css";
import "@bryntum/calendar/fontawesome/css/solid.css";
import "@bryntum/calendar/calendar.css";
import "@bryntum/calendar/svalbard-dark.css";
import "./globals.css";
import { cookies } from "next/headers";
import TabBar from "@/components/mobile/TabBar";
import { SESSION_COOKIE } from "@/lib/auth";

export const metadata: Metadata = {
  title: "E-Cinema",
  description: "Watch new film releases live, together, anywhere in the world.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <TabBar signedIn={Boolean((await cookies()).get(SESSION_COOKIE))} />
      </body>
    </html>
  );
}
