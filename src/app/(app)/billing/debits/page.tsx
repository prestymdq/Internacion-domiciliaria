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

const debitSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.string().min(1),
  reason: z.string().min(1),
});

async function createDebit(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "BILLING");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.FACTURACION]);

    const parsed = debitSchema.safeParse({
      invoiceId: formData.get("invoiceId"),
      amount: formData.get("amount"),
      reason: formData.get("reason"),
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

    const debit = await db.debitNote.create({
      data: {
        tenantId: session.user.tenantId,
        invoiceId: invoice.id,
        amount,
        reason: parsed.data.reason,
        createdById: session.user.id,
      },
    });

    await recalcInvoiceStatus(db, parsed.data.invoiceId);

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "debit.create",
      entityType: "DebitNote",
      entityId: debit.id,
    });
  });

  revalidatePath("/billing/debits");
}

export default async function DebitsPage() {
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
    const debits = await db.debitNote.findMany({
      where: { tenantId },
      include: {
        invoice: { include: { items: true, debitNotes: true, payments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Debitos</h1>
          <p className="text-sm text-muted-foreground">
            Rechazos o debitos sobre facturas.
          </p>
        </div>

        <form action={createDebit} className="grid gap-3 md:grid-cols-3">
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
          <Input name="reason" placeholder="Motivo" required />
          <Button type="submit" className="md:col-span-3">
            Registrar debito
          </Button>
        </form>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Factura</th>
                <th className="px-3 py-2">Monto</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {debits.map((debit) => {
                const totalItems = debit.invoice.items.reduce(
                  (sum, item) => sum + item.total,
                  0,
                );
                const totalDebits = debit.invoice.debitNotes.reduce(
                  (sum, entry) => sum + entry.amount,
                  0,
                );
                const totalPayments = debit.invoice.payments.reduce(
                  (sum, entry) => sum + entry.amount,
                  0,
                );
                const balance = Math.max(totalItems - totalDebits - totalPayments, 0);

                return (
                  <tr key={debit.id} className="border-t">
                    <td className="px-3 py-2">{debit.invoice.invoiceNumber}</td>
                    <td className="px-3 py-2">{debit.amount.toFixed(2)}</td>
                    <td className="px-3 py-2">{debit.reason}</td>
                    <td className="px-3 py-2">
                      {debit.createdAt.toLocaleDateString("es-AR")}
                    </td>
                    <td className="px-3 py-2">{balance.toFixed(2)}</td>
                  </tr>
                );
              })}
              {debits.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-4 text-sm text-muted-foreground"
                    colSpan={5}
                  >
                    Sin debitos aun.
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
