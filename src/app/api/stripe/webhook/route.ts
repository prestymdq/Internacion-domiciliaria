import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe";
import { PlanTier, Prisma, TenantStatus } from "@prisma/client";
import { logAudit } from "@/lib/audit";
import type Stripe from "stripe";
import { withSuperadmin } from "@/lib/rls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function planFromPriceId(priceId?: string | null): PlanTier | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return PlanTier.STARTER;
  if (priceId === process.env.STRIPE_PRICE_PRO) return PlanTier.PRO;
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return PlanTier.ENTERPRISE;
  return null;
}

function tenantStatusFromSubscription(status: Stripe.Subscription.Status) {
  if (status === "active" || status === "trialing") return TenantStatus.ACTIVE;
  if (status === "past_due") return TenantStatus.PAST_DUE;
  if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
    return TenantStatus.SUSPENDED;
  }
  return TenantStatus.TRIALING;
}

async function tenantIdFromInvoice(invoice: Stripe.Invoice) {
  if (invoice.metadata?.tenantId) {
    return invoice.metadata.tenantId;
  }
  if (invoice.subscription) {
    const subscription = await stripe.subscriptions.retrieve(
      invoice.subscription as string,
    );
    return subscription.metadata?.tenantId ?? null;
  }
  return null;
}

async function upsertSubscriptionFromStripe(
  db: Prisma.TransactionClient,
  subscription: Stripe.Subscription,
) {
  const tenantId = subscription.metadata?.tenantId;
  if (!tenantId) return;

  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const plan = planFromPriceId(priceId);
  const seatCount = subscription.items.data[0]?.quantity ?? null;
  const status = tenantStatusFromSubscription(subscription.status);

  await db.tenantSubscription.upsert({
    where: { tenantId },
    update: {
      stripeCustomerId: subscription.customer as string,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      seatCount: seatCount ?? null,
    },
    create: {
      tenantId,
      stripeCustomerId: subscription.customer as string,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      trialEnd: subscription.trial_end
        ? new Date(subscription.trial_end * 1000)
        : null,
      seatCount: seatCount ?? null,
    },
  });

  await db.tenant.update({
    where: { id: tenantId },
    data: {
      status,
      plan: plan ?? undefined,
    },
  });
}

export async function POST(request: Request) {
  const signature = (await headers()).get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
  const stripe = getStripe();

  if (!signature || !webhookSecret || !stripe) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    return new Response("Webhook Error", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = session.subscription as string | null;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await withSuperadmin((db) => upsertSubscriptionFromStripe(db, subscription));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await withSuperadmin((db) => upsertSubscriptionFromStripe(db, subscription));
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const tenantId = await tenantIdFromInvoice(invoice);
      if (tenantId) {
        await withSuperadmin((db) =>
          db.tenant.update({
            where: { id: tenantId },
            data: { status: TenantStatus.PAST_DUE },
          }),
        );
      }
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const tenantId = await tenantIdFromInvoice(invoice);
      if (tenantId) {
        await withSuperadmin((db) =>
          db.tenant.update({
            where: { id: tenantId },
            data: { status: TenantStatus.ACTIVE },
          }),
        );
      }
      break;
    }
    default:
      break;
  }

  await withSuperadmin((db) =>
    logAudit(db, {
      action: "billing.event",
      entityType: "StripeEvent",
      entityId: event.id,
      meta: { type: event.type },
    }),
  );

  return new Response("ok", { status: 200 });
}
