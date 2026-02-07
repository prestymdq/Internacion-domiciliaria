import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return null;
  }
  if (!stripeClient) {
    stripeClient = new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20",
    });
  }
  return stripeClient;
}

export function requireStripe() {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }
  return stripe;
}
