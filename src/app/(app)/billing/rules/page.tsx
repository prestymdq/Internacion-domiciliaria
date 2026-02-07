import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const ruleSchema = z.object({
  payerId: z.string().min(1),
  planId: z.string().optional(),
  productId: z.string().min(1),
  unitPrice: z.string().min(1),
  honorarium: z.string().optional(),
});

const ruleUpdateSchema = z.object({
  ruleId: z.string().min(1),
  unitPrice: z.string().min(1),
  honorarium: z.string().optional(),
});

async function upsertRule(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.FACTURACION]);

    const parsed = ruleSchema.safeParse({
      payerId: formData.get("payerId"),
      planId: formData.get("planId"),
      productId: formData.get("productId"),
      unitPrice: formData.get("unitPrice"),
      honorarium: formData.get("honorarium"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const unitPrice = Number(parsed.data.unitPrice);
    const honorarium = parsed.data.honorarium
      ? Number(parsed.data.honorarium)
      : 0;

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error("INVALID_UNIT_PRICE");
    }
    if (!Number.isFinite(honorarium) || honorarium < 0) {
      throw new Error("INVALID_HONORARIUM");
    }

    const planId = parsed.data.planId || null;

    const existing = await db.billingRule.findFirst({
      where: {
        tenantId: session.user.tenantId,
        payerId: parsed.data.payerId,
        planId,
        productId: parsed.data.productId,
      },
    });

    const rule = existing
      ? await db.billingRule.update({
          where: { id: existing.id },
          data: { unitPrice, honorarium },
        })
      : await db.billingRule.create({
          data: {
            tenantId: session.user.tenantId,
            payerId: parsed.data.payerId,
            planId,
            productId: parsed.data.productId,
            unitPrice,
            honorarium,
          },
        });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "billing.rule.upsert",
      entityType: "BillingRule",
      entityId: rule.id,
      meta: { unitPrice, honorarium },
    });
  });

  revalidatePath("/billing/rules");
}

async function updateRule(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.FACTURACION]);

    const parsed = ruleUpdateSchema.safeParse({
      ruleId: formData.get("ruleId"),
      unitPrice: formData.get("unitPrice"),
      honorarium: formData.get("honorarium"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const unitPrice = Number(parsed.data.unitPrice);
    const honorarium = parsed.data.honorarium
      ? Number(parsed.data.honorarium)
      : 0;

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error("INVALID_UNIT_PRICE");
    }
    if (!Number.isFinite(honorarium) || honorarium < 0) {
      throw new Error("INVALID_HONORARIUM");
    }

    const rule = await db.billingRule.update({
      where: { id: parsed.data.ruleId },
      data: { unitPrice, honorarium },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "billing.rule.update",
      entityType: "BillingRule",
      entityId: rule.id,
      meta: { unitPrice, honorarium },
    });
  });

  revalidatePath("/billing/rules");
}

export default async function BillingRulesPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "BILLING");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const payers = await db.payer.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const plans = await db.payerPlan.findMany({
      where: { tenantId },
      include: { payer: true },
      orderBy: { name: "asc" },
    });
    const products = await db.product.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const rules = await db.billingRule.findMany({
      where: { tenantId },
      include: { payer: true, plan: true, product: true },
      orderBy: { updatedAt: "desc" },
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Reglas de facturacion</h1>
          <p className="text-sm text-muted-foreground">
            Precios por obra social/plan y honorarios por item.
          </p>
        </div>

        <form action={upsertRule} className="grid gap-3 md:grid-cols-5">
          <select
            name="payerId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            required
          >
            <option value="">Obra social...</option>
            {payers.map((payer) => (
              <option key={payer.id} value={payer.id}>
                {payer.name}
              </option>
            ))}
          </select>
          <select
            name="planId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Plan (opcional)...</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.payer.name} - {plan.name}
              </option>
            ))}
          </select>
          <select
            name="productId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            required
          >
            <option value="">Producto...</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
          <Input name="unitPrice" type="number" step="0.01" placeholder="Precio" />
          <Input
            name="honorarium"
            type="number"
            step="0.01"
            placeholder="Honorario"
          />
          <Button type="submit" className="md:col-span-5">
            Guardar regla
          </Button>
        </form>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Obra social</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Precio y honorario</th>
                <th className="px-3 py-2">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t">
                  <td className="px-3 py-2">{rule.payer.name}</td>
                  <td className="px-3 py-2">
                    {rule.plan ? rule.plan.name : "General"}
                  </td>
                  <td className="px-3 py-2">{rule.product.name}</td>
                  <td className="px-3 py-2">
                    <form action={updateRule} className="flex items-center gap-2">
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <Input
                        name="unitPrice"
                        type="number"
                        step="0.01"
                        className="h-8 w-24"
                        defaultValue={rule.unitPrice}
                      />
                      <Input
                        name="honorarium"
                        type="number"
                        step="0.01"
                        className="h-8 w-24"
                        defaultValue={rule.honorarium}
                      />
                      <Button size="sm" variant="outline" type="submit">
                        Actualizar
                      </Button>
                    </form>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {rule.updatedAt.toLocaleDateString("es-AR")}
                    </span>
                  </td>
                </tr>
              ))}
              {rules.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-4 text-sm text-muted-foreground"
                    colSpan={5}
                  >
                    Sin reglas aun.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  });
}
