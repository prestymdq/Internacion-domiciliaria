import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import { nextInvoiceNumber } from "@/lib/sequence";
import { recalcInvoiceStatus } from "@/lib/billing";
import { AuthorizationStatus, Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const invoiceSchema = z.object({
  deliveryId: z.string().min(1),
  authorizationId: z.string().min(1),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

async function createInvoice(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.FACTURACION]);

    const parsed = invoiceSchema.safeParse({
      deliveryId: formData.get("deliveryId"),
      authorizationId: formData.get("authorizationId"),
      dueDate: formData.get("dueDate"),
      notes: formData.get("notes"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const delivery = await db.delivery.findFirst({
      where: { id: parsed.data.deliveryId, tenantId: session.user.tenantId },
      include: {
        approvedOrder: { include: { patient: true } },
        pickList: { include: { items: { include: { product: true } } } },
        evidence: true,
      },
    });

    if (!delivery) {
      throw new Error("DELIVERY_NOT_FOUND");
    }

    if (!["DELIVERED", "CLOSED"].includes(delivery.status)) {
      throw new Error("DELIVERY_NOT_READY");
    }

    const minEvidence = Number(process.env.DELIVERY_MIN_EVIDENCE ?? "1");
    if (delivery.evidence.length < minEvidence) {
      throw new Error("EVIDENCE_REQUIRED");
    }

    const existingItem = await db.invoiceItem.findFirst({
      where: { deliveryId: delivery.id },
    });
    if (existingItem) {
      throw new Error("DELIVERY_ALREADY_INVOICED");
    }

    const authorization = await db.authorization.findFirst({
      where: {
        id: parsed.data.authorizationId,
        tenantId: session.user.tenantId,
      },
      include: { requirements: { include: { requirement: true } }, payer: true },
    });

    if (!authorization) {
      throw new Error("AUTHORIZATION_NOT_FOUND");
    }

    if (authorization.patientId !== delivery.approvedOrder.patientId) {
      throw new Error("AUTHORIZATION_MISMATCH");
    }

    if (authorization.status !== AuthorizationStatus.ACTIVE) {
      throw new Error("AUTHORIZATION_NOT_ACTIVE");
    }

    const effectiveDate = delivery.deliveredAt ?? new Date();
    if (authorization.startDate > effectiveDate) {
      throw new Error("AUTHORIZATION_NOT_STARTED");
    }
    if (authorization.endDate && authorization.endDate < effectiveDate) {
      throw new Error("AUTHORIZATION_EXPIRED");
    }

    const pendingRequirements = authorization.requirements.filter(
      (req) =>
        req.requirement.isRequired &&
        req.status !== "SUBMITTED" &&
        req.status !== "APPROVED",
    );
    if (pendingRequirements.length > 0) {
      throw new Error("AUTHORIZATION_REQUIREMENTS_PENDING");
    }

    const billableItems = delivery.pickList.items.filter(
      (item) => item.pickedQty > 0,
    );

    if (billableItems.length === 0) {
      throw new Error("NO_BILLABLE_ITEMS");
    }

    const productIds = billableItems.map((item) => item.productId);
    const rulesForPlan = await db.billingRule.findMany({
      where: {
        tenantId: session.user.tenantId,
        payerId: authorization.payerId,
        planId: authorization.planId ?? null,
        productId: { in: productIds },
      },
    });
    const fallbackRules =
      authorization.planId
        ? await db.billingRule.findMany({
            where: {
              tenantId: session.user.tenantId,
              payerId: authorization.payerId,
              planId: null,
              productId: { in: productIds },
            },
          })
        : [];

    const ruleByProduct = new Map(
      rulesForPlan.map((rule) => [rule.productId, rule]),
    );
    fallbackRules.forEach((rule) => {
      if (!ruleByProduct.has(rule.productId)) {
        ruleByProduct.set(rule.productId, rule);
      }
    });

    const missingRule = billableItems.find(
      (item) => !ruleByProduct.has(item.productId),
    );
    if (missingRule) {
      throw new Error("BILLING_RULE_MISSING");
    }

    const items = billableItems.map((item) => {
      const rule = ruleByProduct.get(item.productId);
      if (!rule) {
        throw new Error("BILLING_RULE_MISSING");
      }
      const unitPrice = rule.unitPrice;
      const honorarium = rule.honorarium;
      const total = (unitPrice + honorarium) * item.pickedQty;
      return {
        deliveryId: delivery.id,
        productId: item.productId,
        description: item.product.name,
        quantity: item.pickedQty,
        unitPrice,
        honorarium,
        total,
        evidenceCount: delivery.evidence.length,
        evidenceMeta: {
          evidenceIds: delivery.evidence.map((evidence) => evidence.id),
        },
      };
    });

    const existingAuthorizationItems = await db.invoiceItem.findMany({
      where: {
        invoice: {
          authorizationId: authorization.id,
          status: { not: "CANCELLED" },
        },
      },
      select: { quantity: true, total: true },
    });

    const usedUnits = existingAuthorizationItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const usedAmount = existingAuthorizationItems.reduce(
      (sum, item) => sum + item.total,
      0,
    );

    const newUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    const newAmount = items.reduce((sum, item) => sum + item.total, 0);

    if (
      authorization.limitUnits !== null &&
      usedUnits + newUnits > authorization.limitUnits
    ) {
      throw new Error("AUTHORIZATION_LIMIT_UNITS");
    }

    if (
      authorization.limitAmount !== null &&
      usedAmount + newAmount > authorization.limitAmount
    ) {
      throw new Error("AUTHORIZATION_LIMIT_AMOUNT");
    }

    const invoiceNumber = await nextInvoiceNumber(
      db,
      session.user.tenantId,
    );

    const invoice = await db.invoice.create({
      data: {
        tenantId: session.user.tenantId,
        payerId: authorization.payerId,
        planId: authorization.planId ?? null,
        patientId: delivery.approvedOrder.patientId,
        authorizationId: authorization.id,
        invoiceNumber,
        dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
        notes: parsed.data.notes ?? null,
        createdById: session.user.id,
        items: { create: items },
      },
    });

    await recalcInvoiceStatus(db, invoice.id);

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "invoice.create",
      entityType: "Invoice",
      entityId: invoice.id,
      meta: { invoiceNumber },
    });
  });

  revalidatePath("/billing/invoices");
}

export default async function InvoicesPage() {
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
    const deliveries = await db.delivery.findMany({
      where: { tenantId, status: { in: ["DELIVERED", "CLOSED"] } },
      include: {
        approvedOrder: { include: { patient: true } },
        pickList: { include: { items: { include: { product: true } } } },
        evidence: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const authorizations = await db.authorization.findMany({
      where: { tenantId },
      include: {
        payer: true,
        plan: true,
        patient: true,
        requirements: { include: { requirement: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const invoices = await db.invoice.findMany({
      where: { tenantId },
      include: { payer: true, patient: true, authorization: true, plan: true },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Facturas</h1>
          <p className="text-sm text-muted-foreground">
            Facturacion por reglas y autorizacion valida.
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <div className="text-sm font-medium">Exportar por obra social</div>
          <div className="mt-2 flex flex-wrap gap-3">
            <form action="/api/billing/invoices/export" method="get">
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
              <input type="hidden" name="format" value="csv" />
              <Button size="sm" type="submit" className="ml-2">
                CSV
              </Button>
            </form>
            <form action="/api/billing/invoices/export" method="get">
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
              <input type="hidden" name="format" value="pdf" />
              <Button size="sm" type="submit" className="ml-2" variant="outline">
                PDF
              </Button>
            </form>
          </div>
        </div>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Crear factura</h2>
          <div className="space-y-4">
            {deliveries.map((delivery) => {
              const effectiveDate = delivery.deliveredAt ?? new Date();
              const availableAuthorizations = authorizations.filter(
                (authorization) => {
                  if (
                    authorization.patientId !==
                    delivery.approvedOrder.patientId
                  ) {
                    return false;
                  }
                  if (authorization.status !== AuthorizationStatus.ACTIVE) {
                    return false;
                  }
                  if (authorization.startDate > effectiveDate) {
                    return false;
                  }
                  if (authorization.endDate && authorization.endDate < effectiveDate) {
                    return false;
                  }
                  const pendingRequirements = authorization.requirements.filter(
                    (req) =>
                      req.requirement.isRequired &&
                      req.status !== "SUBMITTED" &&
                      req.status !== "APPROVED",
                  );
                  if (pendingRequirements.length > 0) {
                    return false;
                  }
                  return true;
                },
              );
              const billableItems = delivery.pickList.items.filter(
                (item) => item.pickedQty > 0,
              );

              return (
                <div key={delivery.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">
                        {delivery.deliveryNumber} -{" "}
                        {delivery.approvedOrder.patient.lastName},{" "}
                        {delivery.approvedOrder.patient.firstName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Evidencias: {delivery.evidence.length}
                      </div>
                    </div>
                  </div>
                  <form action={createInvoice} className="mt-3 space-y-3">
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <div className="grid gap-3 md:grid-cols-3">
                      <select
                        name="authorizationId"
                        className="h-10 rounded-md border bg-background px-3 text-sm"
                        required
                      >
                        <option value="">Autorizacion...</option>
                        {availableAuthorizations.map((authorization) => (
                          <option key={authorization.id} value={authorization.id}>
                            {authorization.payer.name} - {authorization.number} (
                            {authorization.status})
                          </option>
                        ))}
                      </select>
                      <Input name="dueDate" type="date" placeholder="Vencimiento" />
                      <Input name="notes" placeholder="Notas" />
                    </div>
                    {availableAuthorizations.length === 0 ? (
                      <p className="text-xs text-amber-600">
                        Sin autorizaciones activas y vigentes para este paciente.
                      </p>
                    ) : null}
                    {billableItems.length === 0 ? (
                      <p className="text-xs text-amber-600">
                        No hay items facturables en esta entrega.
                      </p>
                    ) : null}
                    <div className="overflow-hidden rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40 text-left">
                          <tr>
                            <th className="px-3 py-2">Producto</th>
                            <th className="px-3 py-2">Cantidad</th>
                            <th className="px-3 py-2">Regla</th>
                          </tr>
                        </thead>
                        <tbody>
                        {billableItems.map((item) => (
                          <tr key={item.id} className="border-t">
                            <td className="px-3 py-2">{item.product.name}</td>
                            <td className="px-3 py-2">{item.pickedQty}</td>
                            <td className="px-3 py-2">
                              Se aplica regla configurada
                            </td>
                          </tr>
                        ))}
                        </tbody>
                      </table>
                    </div>
                    <Button
                      size="sm"
                      type="submit"
                      disabled={
                        availableAuthorizations.length === 0 ||
                        billableItems.length === 0
                      }
                    >
                      Crear factura
                    </Button>
                  </form>
                </div>
              );
            })}
            {deliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay entregas listas para facturar.
              </p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Facturas emitidas</h2>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Factura</th>
                  <th className="px-3 py-2">Payer</th>
                  <th className="px-3 py-2">Paciente</th>
                  <th className="px-3 py-2">Autorizacion</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t">
                    <td className="px-3 py-2">{invoice.invoiceNumber}</td>
                    <td className="px-3 py-2">{invoice.payer.name}</td>
                    <td className="px-3 py-2">
                      {invoice.patient.lastName}, {invoice.patient.firstName}
                    </td>
                    <td className="px-3 py-2">
                      {invoice.authorization?.number ?? "-"}
                    </td>
                    <td className="px-3 py-2">{invoice.status}</td>
                    <td className="px-3 py-2">
                      {invoice.totalAmount.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-4 text-sm text-muted-foreground"
                      colSpan={6}
                    >
                      Sin facturas aun.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  });
}
