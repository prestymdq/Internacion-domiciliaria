import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import { PlanTier } from "@prisma/client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { withTenant } from "@/lib/rls";
import AccessDenied from "@/components/app/access-denied";

const priceMap: Record<PlanTier, string> = {
  STARTER: process.env.STRIPE_PRICE_STARTER ?? "",
  PRO: process.env.STRIPE_PRICE_PRO ?? "",
  ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE ?? "",
};

const moduleOptions = [
  { key: "LOGISTICS", label: "Logística" },
  { key: "INVENTORY", label: "Inventario" },
  { key: "PAYERS", label: "Obras sociales" },
  { key: "AUTHORIZATIONS", label: "Autorizaciones" },
  { key: "ANALYTICS", label: "KPIs" },
];

async function createCheckout(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  const plan = formData.get("plan") as PlanTier;
  const priceId = priceMap[plan];
  if (!priceId) {
    throw new Error("PRICE_NOT_CONFIGURED");
  }

  const { tenant, users, subscription } = await withTenant(
    session.user.tenantId,
    async (db) => {
      await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");

      const tenant = await db.tenant.findUnique({
        where: { id: session.user.tenantId },
      });
      const users = await db.user.count({
        where: { tenantId: session.user.tenantId, isActive: true },
      });
      const subscription = await db.tenantSubscription.findUnique({
        where: { tenantId: session.user.tenantId },
      });
      return { tenant, users, subscription };
    },
  );

  if (!tenant) {
    throw new Error("TENANT_NOT_FOUND");
  }

  const seatCount = Math.max(users, 1);

  let stripeCustomerId = subscription?.stripeCustomerId ?? null;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: session.user.email ?? undefined,
      name: tenant.name,
      metadata: { tenantId: tenant.id },
    });
    stripeCustomerId = customer.id;
    await withTenant(session.user.tenantId, async (db) => {
      await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");
      await db.tenantSubscription.upsert({
        where: { tenantId: tenant.id },
        update: { stripeCustomerId },
        create: { tenantId: tenant.id, stripeCustomerId },
      });
    });
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomerId ?? undefined,
    line_items: [{ price: priceId, quantity: seatCount }],
    success_url:
      process.env.STRIPE_SUCCESS_URL ?? "http://localhost:3000/billing?success=1",
    cancel_url:
      process.env.STRIPE_CANCEL_URL ?? "http://localhost:3000/billing?canceled=1",
    metadata: {
      tenantId: tenant.id,
      plan,
      seatCount: `${seatCount}`,
    },
    subscription_data: {
      metadata: { tenantId: tenant.id, plan },
    },
  });

  if (!checkout.url) {
    throw new Error("CHECKOUT_FAILED");
  }

  redirect(checkout.url);
}

async function openPortal() {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  const subscription = await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");
    return db.tenantSubscription.findUnique({
      where: { tenantId: session.user.tenantId },
    });
  });

  if (!subscription?.stripeCustomerId) {
    throw new Error("NO_CUSTOMER");
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url:
      process.env.STRIPE_PORTAL_RETURN_URL ?? "http://localhost:3000/billing",
  });

  redirect(portal.url);
}

async function updatePastDuePolicy(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");

    const blocked = moduleOptions
      .filter((option) => formData.get(option.key) === "on")
      .map((option) => option.key);

    await db.tenantPolicy.upsert({
      where: { tenantId: session.user.tenantId },
      update: { pastDueBlockedModules: blocked },
      create: {
        tenantId: session.user.tenantId,
        pastDueBlockedModules: blocked,
      },
    });
  });
}

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Seleccioná un tenant.
        </p>
      </div>
    );
  }

  return withTenant(session.user.tenantId, async (db) => {
    const access = await getTenantModuleAccess(
      db,
      session.user.tenantId,
      "BILLING",
    );
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const tenant = await db.tenant.findUnique({
      where: { id: session.user.tenantId },
    });
    const subscription = await db.tenantSubscription.findUnique({
      where: { tenantId: session.user.tenantId },
    });
    const activeUsers = await db.user.count({
      where: { tenantId: session.user.tenantId, isActive: true },
    });
    const policy = await db.tenantPolicy.findUnique({
      where: { tenantId: session.user.tenantId },
    });

    const blockedModules =
      (policy?.pastDueBlockedModules as string[] | null) ?? [];

    return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Estado del plan y facturación.
        </p>
      </div>
      <div className="rounded-lg border p-4">
        <p className="text-sm">Plan: {tenant?.plan ?? "-"}</p>
        <p className="text-sm">Status: {tenant?.status ?? "-"}</p>
        <p className="text-sm">
          Trial:{" "}
          {tenant?.trialEndsAt
            ? tenant.trialEndsAt.toLocaleDateString("es-AR")
            : "-"}
        </p>
        <p className="text-sm">Seats activos: {activeUsers}</p>
        <p className="text-sm">
          Suscripción: {subscription?.status ?? "Sin suscripción"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["STARTER", "PRO", "ENTERPRISE"] as PlanTier[]).map((plan) => (
            <form key={plan} action={createCheckout}>
              <input type="hidden" name="plan" value={plan} />
              <Button size="sm" type="submit" variant="outline">
                {plan}
              </Button>
            </form>
          ))}
          {subscription?.stripeCustomerId ? (
            <form action={openPortal}>
              <Button size="sm" type="submit">
                Abrir portal Stripe
              </Button>
            </form>
          ) : null}
          <Button asChild size="sm" variant="secondary">
            <Link href="/billing/preliquidation">Pre-liquidación</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/billing/invoices">Facturas</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/billing/rules">Reglas</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/billing/debits">Débitos</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/billing/payments">Pagos</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/billing/aging">Aging</Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <div className="text-sm font-medium">Bloqueos en mora (PAST_DUE)</div>
        <p className="text-xs text-muted-foreground">
          Módulos bloqueados cuando el tenant está en mora. Configurable.
        </p>
        <form action={updatePastDuePolicy} className="mt-3 space-y-2">
          {moduleOptions.map((option) => (
            <label key={option.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={option.key}
                defaultChecked={blockedModules.includes(option.key)}
              />
              {option.label}
            </label>
          ))}
          <Button size="sm" type="submit" className="mt-2">
            Guardar bloqueos
          </Button>
        </form>
      </div>
    </div>
    );
  });
}
