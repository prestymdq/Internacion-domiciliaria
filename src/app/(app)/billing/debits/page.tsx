import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { assertTenantModuleAccess, getTenantModuleAccess } from "@/lib/tenant-access";
import { recalcInvoiceStatus } from "@/lib/billing";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AccessDenied from "@/components/app/access-denied";

const debitSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.string().min(1),
  reason: z.string().min(1),
});

async function createDebit(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await assertTenantModuleAccess(session.user.tenantId, "BILLING");
  assertRole(session.user.role, [Role.ADMIN_TENANT, Role.FACTURACION]);

  const parsed = debitSchema.safeParse({
    invoiceId: formData.get("invoiceId"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const debit = await prisma.debitNote.create({
    data: {
      tenantId: session.user.tenantId,
      invoiceId: parsed.data.invoiceId,
      amount: Number(parsed.data.amount),
      reason: parsed.data.reason,
      createdById: session.user.id,
    },
  });

  await recalcInvoiceStatus(parsed.data.invoiceId);

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "debit.create",
    entityType: "DebitNote",
    entityId: debit.id,
  });

  revalidatePath("/billing/debits");
}

export default async function DebitsPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  const access = await getTenantModuleAccess(tenantId, "BILLING");
  if (!access.allowed) {
    return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
  }

  const [invoices, debits] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.debitNote.findMany({
      where: { tenantId },
      include: { invoice: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Débitos</h1>
        <p className="text-sm text-muted-foreground">
          Rechazos / débitos sobre facturas.
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
        <Input name="amount" type="number" step="0.01" placeholder="Monto" />
        <Input name="reason" placeholder="Motivo" />
        <Button type="submit" className="md:col-span-3">
          Registrar débito
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
            </tr>
          </thead>
          <tbody>
            {debits.map((debit) => (
              <tr key={debit.id} className="border-t">
                <td className="px-3 py-2">{debit.invoice.invoiceNumber}</td>
                <td className="px-3 py-2">{debit.amount.toFixed(2)}</td>
                <td className="px-3 py-2">{debit.reason}</td>
                <td className="px-3 py-2">
                  {debit.createdAt.toLocaleDateString("es-AR")}
                </td>
              </tr>
            ))}
            {debits.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-sm text-muted-foreground"
                  colSpan={4}
                >
                  Sin débitos aún.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
