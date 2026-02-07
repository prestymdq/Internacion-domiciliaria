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
import { recalcInvoiceStatus } from "@/lib/billing";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.string().min(1),
  method: z.string().optional(),
  reference: z.string().optional(),
  paidAt: z.string().optional(),
});

async function createPayment(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.FACTURACION]);

    const parsed = paymentSchema.safeParse({
      invoiceId: formData.get("invoiceId"),
      amount: formData.get("amount"),
      method: formData.get("method"),
      reference: formData.get("reference"),
      paidAt: formData.get("paidAt"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const invoice = await db.invoice.findFirst({
      where: { id: parsed.data.invoiceId, tenantId: session.user.tenantId },
    });
    if (!invoice) {
      throw new Error("INVOICE_NOT_FOUND");
    }

    const amount = Number(parsed.data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("INVALID_AMOUNT");
    }

    const payment = await db.payment.create({
      data: {
        tenantId: session.user.tenantId,
        invoiceId: invoice.id,
        amount,
        method: parsed.data.method ?? null,
        reference: parsed.data.reference ?? null,
        paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : new Date(),
        createdById: session.user.id,
      },
    });

    await recalcInvoiceStatus(db, parsed.data.invoiceId);

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "payment.create",
      entityType: "Payment",
      entityId: payment.id,
    });
  });

  revalidatePath("/billing/payments");
}

export default async function PaymentsPage() {
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

    const invoices = await db.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
    const payments = await db.payment.findMany({
      where: { tenantId },
      include: {
        invoice: {
          include: { items: true, debitNotes: true, payments: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Pagos</h1>
          <p className="text-sm text-muted-foreground">
            Registro de pagos y conciliacion por factura.
          </p>
        </div>

        <form action={createPayment} className="grid gap-3 md:grid-cols-4">
          <select
            name="invoiceId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            required
          >
            <option value="">Factura...</option>
            {invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.invoiceNumber}
              </option>
            ))}
          </select>
          <Input
            name="amount"
            type="number"
            step="0.01"
            placeholder="Monto"
            required
          />
          <Input name="method" placeholder="Metodo" />
          <Input name="reference" placeholder="Referencia" />
          <Input name="paidAt" type="date" />
          <Button type="submit" className="md:col-span-4">
            Registrar pago
          </Button>
        </form>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Factura</th>
                <th className="px-3 py-2">Monto</th>
                <th className="px-3 py-2">Metodo</th>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const totalItems = payment.invoice.items.reduce(
                  (sum, item) => sum + item.total,
                  0,
                );
                const totalDebits = payment.invoice.debitNotes.reduce(
                  (sum, debit) => sum + debit.amount,
                  0,
                );
                const totalPayments = payment.invoice.payments.reduce(
                  (sum, entry) => sum + entry.amount,
                  0,
                );
                const balance = Math.max(totalItems - totalDebits - totalPayments, 0);

                return (
                  <tr key={payment.id} className="border-t">
                    <td className="px-3 py-2">
                      {payment.invoice.invoiceNumber}
                    </td>
                    <td className="px-3 py-2">{payment.amount.toFixed(2)}</td>
                    <td className="px-3 py-2">{payment.method ?? "-"}</td>
                    <td className="px-3 py-2">{payment.reference ?? "-"}</td>
                    <td className="px-3 py-2">
                      {payment.paidAt.toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-3 py-2">{balance.toFixed(2)}</td>
                  </tr>
                );
              })}
              {payments.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-4 text-sm text-muted-foreground"
                    colSpan={6}
                  >
                    Sin pagos aun.
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
