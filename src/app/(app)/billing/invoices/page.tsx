import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { assertTenantModuleAccess, getTenantModuleAccess } from "@/lib/tenant-access";
import { nextInvoiceNumber } from "@/lib/sequence";
import { recalcInvoiceStatus } from "@/lib/billing";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const invoiceSchema = z.object({
  deliveryId: z.string().min(1),
  payerId: z.string().min(1),
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
      payerId: formData.get("payerId"),
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

    const invoiceNumber = await nextInvoiceNumber(
      db,
      session.user.tenantId,
    );

    const items = delivery.pickList.items.map((item) => {
      const priceRaw = formData.get(`price_${item.id}`);
      const unitPrice = Number(priceRaw ?? 0);
      const total = unitPrice * item.pickedQty;
      return {
        deliveryId: delivery.id,
        productId: item.productId,
        description: item.product.name,
        quantity: item.pickedQty,
        unitPrice,
        total,
        evidenceCount: delivery.evidence.length,
        evidenceMeta: {
          evidenceIds: delivery.evidence.map((evidence) => evidence.id),
        },
      };
    });

    const invoice = await db.invoice.create({
      data: {
        tenantId: session.user.tenantId,
        payerId: parsed.data.payerId,
        patientId: delivery.approvedOrder.patientId,
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
    const invoices = await db.invoice.findMany({
      where: { tenantId },
      include: { payer: true, patient: true },
      orderBy: { createdAt: "desc" },
    });

    return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Facturas</h1>
        <p className="text-sm text-muted-foreground">
          Generación de facturas por entregas evidenciadas.
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
          {deliveries.map((delivery) => (
            <div key={delivery.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    {delivery.deliveryNumber} ·{" "}
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
                  <Input name="dueDate" type="date" placeholder="Vencimiento" />
                  <Input name="notes" placeholder="Notas" />
                </div>
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2">Producto</th>
                        <th className="px-3 py-2">Cantidad</th>
                        <th className="px-3 py-2">Precio unitario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {delivery.pickList.items.map((item) => (
                        <tr key={item.id} className="border-t">
                          <td className="px-3 py-2">{item.product.name}</td>
                          <td className="px-3 py-2">{item.pickedQty}</td>
                          <td className="px-3 py-2">
                            <Input
                              name={`price_${item.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button size="sm" type="submit">
                  Crear factura
                </Button>
              </form>
            </div>
          ))}
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
                    colSpan={5}
                  >
                    Sin facturas aún.
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
