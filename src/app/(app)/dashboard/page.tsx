import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { Button } from "@/components/ui/button";
import { Role } from "@prisma/client";
import { withTenant } from "@/lib/rls";

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  const role = session?.user?.role as Role | undefined;

  if (!tenantId) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Selecciona un tenant para ver el tablero.
        </p>
      </div>
    );
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "ANALYTICS");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);

    const visitOverdue = await db.visit.count({
      where: {
        tenantId,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: { lt: today },
      },
    });
    const deliveryOverdue = await db.delivery.count({
      where: {
        tenantId,
        status: { in: ["DRAFT", "PACKED", "IN_TRANSIT", "INCIDENT"] },
        scheduledAt: { lt: today },
      },
    });
    const overdueInvoices = await db.invoice.findMany({
      where: {
        tenantId,
        dueDate: { lt: today },
        status: { in: ["ISSUED", "PARTIAL"] },
      },
      include: { debitNotes: true, payments: true },
    });
    const overdueInvoiceCount = overdueInvoices.filter((invoice) => {
      const debits = invoice.debitNotes.reduce(
        (sum, debit) => sum + debit.amount,
        0,
      );
      const payments = invoice.payments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      const balance = Math.max(invoice.totalAmount - debits - payments, 0);
      return balance > 0;
    }).length;

    const alerts = [
      { label: "Visitas vencidas", value: visitOverdue },
      { label: "Entregas atrasadas", value: deliveryOverdue },
      { label: "Facturas vencidas", value: overdueInvoiceCount },
    ];

    const showClinical =
      role === Role.ADMIN_TENANT || role === Role.COORDINACION;
    const showLogistics = role === Role.LOGISTICA || role === Role.DEPOSITO;
    const showBilling = role === Role.FACTURACION;
    const showProfessional = role === Role.PROFESIONAL;

    let summaryCards: Array<{ label: string; value: number }> = [];
    if (showClinical || !role) {
      const [patients, episodes, visitsToday, deliveriesToday] =
        await Promise.all([
          db.patient.count({ where: { tenantId } }),
          db.episode.count({ where: { tenantId, status: "ACTIVE" } }),
          db.visit.count({
            where: {
              tenantId,
              scheduledAt: { gte: todayStart, lte: todayEnd },
            },
          }),
          db.delivery.count({
            where: {
              tenantId,
              deliveredAt: { gte: todayStart, lte: todayEnd },
            },
          }),
        ]);
      summaryCards = [
        { label: "Pacientes activos", value: patients },
        { label: "Episodios activos", value: episodes },
        { label: "Visitas hoy", value: visitsToday },
        { label: "Entregas hoy", value: deliveriesToday },
      ];
    }

    let logisticsCards: Array<{ label: string; value: number }> = [];
    if (showLogistics) {
      const pickListGroups = await db.pickList.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      });
      const pickListByStatus = new Map(
        pickListGroups.map((group) => [group.status, group._count._all]),
      );
      const inTransit = await db.delivery.count({
        where: { tenantId, status: "IN_TRANSIT" },
      });
      const incidentsOpen = await db.incident.count({
        where: { tenantId, resolvedAt: null },
      });
      logisticsCards = [
        { label: "Picklists draft", value: pickListByStatus.get("DRAFT") ?? 0 },
        {
          label: "Picklists frozen",
          value: pickListByStatus.get("FROZEN") ?? 0,
        },
        {
          label: "Picklists packed",
          value: pickListByStatus.get("PACKED") ?? 0,
        },
        { label: "Entregas en transito", value: inTransit },
        { label: "Incidentes abiertos", value: incidentsOpen },
      ];
    }

    let billingCards: Array<{ label: string; value: number }> = [];
    if (showBilling) {
      const issuedThisMonth = await db.invoice.count({
        where: {
          tenantId,
          issuedAt: {
            gte: new Date(today.getFullYear(), today.getMonth(), 1),
            lte: today,
          },
        },
      });
      const invoices = await db.invoice.findMany({
        where: { tenantId, status: { in: ["ISSUED", "PARTIAL"] } },
        include: { debitNotes: true, payments: true },
      });
      const outstandingTotal = invoices.reduce((sum, invoice) => {
        const debits = invoice.debitNotes.reduce(
          (acc, debit) => acc + debit.amount,
          0,
        );
        const payments = invoice.payments.reduce(
          (acc, payment) => acc + payment.amount,
          0,
        );
        const balance = Math.max(invoice.totalAmount - debits - payments, 0);
        return sum + balance;
      }, 0);
      billingCards = [
        { label: "Facturas mes", value: issuedThisMonth },
        { label: "Saldo pendiente", value: Math.round(outstandingTotal) },
        { label: "Vencidas", value: overdueInvoiceCount },
      ];
    }

    let professionalVisits: Array<{
      id: string;
      scheduledAt: Date;
      status: string;
      patient: { firstName: string; lastName: string };
    }> = [];
    if (showProfessional && session?.user?.id) {
      professionalVisits = await db.visit.findMany({
        where: {
          tenantId,
          assignedUserId: session.user.id,
          scheduledAt: { gte: todayStart, lte: endOfDay(nextWeek) },
        },
        include: { patient: true },
        orderBy: { scheduledAt: "asc" },
        take: 8,
      });
    }

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Resumen operativo por rol y alertas.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/kpis">Ir a KPIs</Link>
          </Button>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Alertas</h2>
          <div className="grid gap-3 md:grid-cols-4">
            {alerts.map((item) => (
              <div key={item.label} className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="text-2xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        {summaryCards.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Clinica</h2>
            <div className="grid gap-3 md:grid-cols-4">
              {summaryCards.map((card) => (
                <div key={card.label} className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">
                    {card.label}
                  </div>
                  <div className="text-2xl font-semibold">{card.value}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {logisticsCards.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Logistica</h2>
            <div className="grid gap-3 md:grid-cols-4">
              {logisticsCards.map((card) => (
                <div key={card.label} className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">
                    {card.label}
                  </div>
                  <div className="text-2xl font-semibold">{card.value}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {billingCards.length > 0 ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Facturacion</h2>
            <div className="grid gap-3 md:grid-cols-4">
              {billingCards.map((card) => (
                <div key={card.label} className="rounded-lg border p-4">
                  <div className="text-xs text-muted-foreground">
                    {card.label}
                  </div>
                  <div className="text-2xl font-semibold">{card.value}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {showProfessional ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Mis proximas visitas</h2>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    <th className="px-3 py-2">Paciente</th>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {professionalVisits.map((visit) => (
                    <tr key={visit.id} className="border-t">
                      <td className="px-3 py-2">
                        {visit.patient.lastName}, {visit.patient.firstName}
                      </td>
                      <td className="px-3 py-2">
                        {visit.scheduledAt.toLocaleString("es-AR")}
                      </td>
                      <td className="px-3 py-2">{visit.status}</td>
                    </tr>
                  ))}
                  {professionalVisits.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-4 text-sm text-muted-foreground"
                        colSpan={3}
                      >
                        Sin visitas asignadas en la semana.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    );
  });
}
