import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

function daysBetween(from: Date, to: Date) {
  const diff = to.getTime() - from.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default async function AgingPage() {
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
      include: { debitNotes: true, payments: true, payer: true },
      orderBy: { issuedAt: "desc" },
    });

    const today = new Date();
    const buckets = {
      "0-30": 0,
      "31-60": 0,
      "61-90": 0,
      "90+": 0,
    };

    const rows = invoices.map((invoice) => {
      const debits = invoice.debitNotes.reduce(
        (sum, debit) => sum + debit.amount,
        0,
      );
      const payments = invoice.payments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      const balance = Math.max(invoice.totalAmount - debits - payments, 0);
      const baseDate = invoice.dueDate ?? invoice.issuedAt;
      const age = daysBetween(baseDate, today);

      if (balance > 0) {
        if (age <= 30) buckets["0-30"] += balance;
        else if (age <= 60) buckets["31-60"] += balance;
        else if (age <= 90) buckets["61-90"] += balance;
        else buckets["90+"] += balance;
      }

      return {
        invoiceNumber: invoice.invoiceNumber,
        payer: invoice.payer.name,
        issuedAt: invoice.issuedAt.toLocaleDateString("es-AR"),
        dueDate: invoice.dueDate
          ? invoice.dueDate.toLocaleDateString("es-AR")
          : "-",
        balance,
        age,
      };
    });

    return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Aging</h1>
        <p className="text-sm text-muted-foreground">
          Vencimientos y saldos por rangos.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {Object.entries(buckets).map(([label, value]) => (
          <div key={label} className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold">{value.toFixed(2)}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Factura</th>
              <th className="px-3 py-2">Payer</th>
              <th className="px-3 py-2">Emisión</th>
              <th className="px-3 py-2">Vencimiento</th>
              <th className="px-3 py-2">Saldo</th>
              <th className="px-3 py-2">Días</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.invoiceNumber} className="border-t">
                <td className="px-3 py-2">{row.invoiceNumber}</td>
                <td className="px-3 py-2">{row.payer}</td>
                <td className="px-3 py-2">{row.issuedAt}</td>
                <td className="px-3 py-2">{row.dueDate}</td>
                <td className="px-3 py-2">{row.balance.toFixed(2)}</td>
                <td className="px-3 py-2">{row.age}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-sm text-muted-foreground"
                  colSpan={6}
                >
                  Sin facturas aún.
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
