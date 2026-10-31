// Creates and reads back a sandbox order with the same SDK the app uses.
// Prints only status values, never credentials.
import { Client, Environment, OrdersController, CheckoutPaymentIntent, ApiError } from "@paypal/paypal-server-sdk";

const client = new Client({
  clientCredentialsAuthCredentials: { oAuthClientId: process.env.PAYPAL_CLIENT_ID, oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET },
  environment: Environment.Sandbox,
  timeout: 15000,
});
const orders = new OrdersController(client);
try {
  const { result: created } = await orders.createOrder({
    body: { intent: CheckoutPaymentIntent.Capture, purchaseUnits: [{ referenceId: "smoke", amount: { currencyCode: "USD", value: "6.99" } }] },
  });
  const { result: fetched } = await orders.getOrder({ id: created.id });
  const approve = created.links?.some((l) => l.rel === "payer-action" || l.rel === "approve");
  console.log(`create: ${created.status}, get: ${fetched.status}, approve link: ${approve ? "yes" : "no"}`);
  if (fetched.status !== "CREATED" && fetched.status !== "PAYER_ACTION_REQUIRED") process.exit(1);
} catch (e) {
  console.log("PayPal error", e instanceof ApiError ? e.statusCode : e?.message);
  process.exit(1);
}
