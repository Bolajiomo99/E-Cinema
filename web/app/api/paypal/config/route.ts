import { NextResponse } from "next/server";
import { paypalEnv } from "@/lib/paypal";

// The client ID is public by design; the secret never leaves the server.
export function GET() {
  return NextResponse.json({ clientId: process.env.PAYPAL_CLIENT_ID ?? null, environment: paypalEnv });
}
