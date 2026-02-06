import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.user.tenantId },
  });

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
        <p className="mt-3 text-xs text-muted-foreground">
          Stripe + gating se implementa en Iteración 3.
        </p>
      </div>
    </div>
  );
}
