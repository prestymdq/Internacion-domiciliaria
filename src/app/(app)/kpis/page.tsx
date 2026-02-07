import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { withTenant } from "@/lib/rls";

const DEFAULT_RANGE_DAYS = 30;
const VISIT_SLA_MINUTES = Number(process.env.VISIT_SLA_MINUTES ?? "30");
const DELIVERY_SLA_HOURS = Number(process.env.DELIVERY_SLA_HOURS ?? "4");

function parseDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

function formatDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

type SearchParams = {
  start?: string;
  end?: string;
  professionalId?: string;
  payerId?: string;
};

export default async function KpisPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  const startParam =
    typeof searchParams?.start === "string" ? searchParams.start : undefined;
  const endParam =
    typeof searchParams?.end === "string" ? searchParams.end : undefined;
  const professionalId =
    typeof searchParams?.professionalId === "string"
      ? searchParams.professionalId
      : "";
  const payerId =
    typeof searchParams?.payerId === "string" ? searchParams.payerId : "";

  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(today.getDate() - DEFAULT_RANGE_DAYS);

  const startDate = parseDate(startParam, defaultStart);
  const endDate = parseDate(endParam, today);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  if (startDate > endDate) {
    const swap = new Date(startDate);
    startDate.setTime(endDate.getTime());
    endDate.setTime(swap.getTime());
  }

  const exportParams = new URLSearchParams();
  exportParams.set("start", formatDateInput(startDate));
  exportParams.set("end", formatDateInput(endDate));
  if (professionalId) exportParams.set("professionalId", professionalId);
  if (payerId) exportParams.set("payerId", payerId);

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "ANALYTICS");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const payers = await db.payer.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const users = await db.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
    });

    const visitFilter = {
      tenantId,
      scheduledAt: { gte: startDate, lte: endDate },
      ...(professionalId ? { assignedUserId: professionalId } : {}),
    };

    const visitGroups = await db.visit.groupBy({
      by: ["status"],
      where: visitFilter,
      _count: { _all: true },
    });

    const complianceGroups = await db.visit.groupBy({
      by: ["assignedUserId", "status"],
      where: {
        ...visitFilter,
        assignedUserId: { not: null },
      },
      _count: { _all: true },
    });

    const completedVisits = await db.visit.findMany({
      where: { ...visitFilter, status: "COMPLETED" },
      select: {
        scheduledAt: true,
        checkInAt: true,
        checkOutAt: true,
        assignedUserId: true,
      },
    });

    const visitCountByStatus = new Map(
      visitGroups.map((group) => [group.status, group._count._all]),
    );
    const visitsScheduled = visitCountByStatus.get("SCHEDULED") ?? 0;
    const visitsCompleted = visitCountByStatus.get("COMPLETED") ?? 0;
    const visitsCancelled = visitCountByStatus.get("CANCELLED") ?? 0;
    const visitsMissed = visitCountByStatus.get("MISSED") ?? 0;

    const visitSlaCutoffMs = VISIT_SLA_MINUTES * 60 * 1000;
    const visitSlaOnTime = completedVisits.filter((visit) => {
      if (!visit.checkInAt) return false;
      return (
        visit.checkInAt.getTime() - visit.scheduledAt.getTime() <=
        visitSlaCutoffMs
      );
    }).length;
    const visitSlaPercent =
      completedVisits.length > 0
        ? Math.round((visitSlaOnTime / completedVisits.length) * 100)
        : 0;

    const visitDurations = completedVisits
      .filter((visit) => visit.checkInAt && visit.checkOutAt)
      .map(
        (visit) =>
          (visit.checkOutAt!.getTime() - visit.checkInAt!.getTime()) / 60000,
      );
    const avgVisitMinutes =
      visitDurations.length > 0
        ? Math.round(
            visitDurations.reduce((sum, value) => sum + value, 0) /
              visitDurations.length,
          )
        : 0;

    const deliveryGroups = await db.delivery.groupBy({
      by: ["status"],
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      _count: { _all: true },
    });
    const deliveryCountByStatus = new Map(
      deliveryGroups.map((group) => [group.status, group._count._all]),
    );

    const deliveredInRange = await db.delivery.findMany({
      where: {
        tenantId,
        deliveredAt: { gte: startDate, lte: endDate },
      },
      select: { scheduledAt: true, deliveredAt: true },
    });

    const deliverySlaCutoffMs = DELIVERY_SLA_HOURS * 60 * 60 * 1000;
    const deliverySlaOnTime = deliveredInRange.filter((delivery) => {
      if (!delivery.scheduledAt || !delivery.deliveredAt) return false;
      return (
        delivery.deliveredAt.getTime() - delivery.scheduledAt.getTime() <=
        deliverySlaCutoffMs
      );
    }).length;
    const deliverySlaPercent =
      deliveredInRange.length > 0
        ? Math.round((deliverySlaOnTime / deliveredInRange.length) * 100)
        : 0;

    const incidentGroups = await db.incident.groupBy({
      by: ["cause"],
      where: { tenantId, createdAt: { gte: startDate, lte: endDate } },
      _count: { _all: true },
    });

    const products = await db.product.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const rawMovements = await db.stockMovement.findMany({
      where: { tenantId },
      select: { productId: true, type: true, quantity: true },
    });
    const stockByProduct = new Map<string, number>();
    for (const movement of rawMovements) {
      const sign = movement.type === "OUT" ? -1 : 1;
      const delta = sign * movement.quantity;
      stockByProduct.set(
        movement.productId,
        (stockByProduct.get(movement.productId) ?? 0) + delta,
      );
    }

    const reservedItems = await db.pickListItem.findMany({
      where: {
        pickList: {
          tenantId,
          status: { in: ["FROZEN", "PACKED"] },
          stockCommittedAt: null,
        },
      },
      select: { productId: true, pickedQty: true, warehouseId: true },
    });
    const reservedByProduct = new Map<string, number>();
    for (const item of reservedItems) {
      if (!item.warehouseId) continue;
      reservedByProduct.set(
        item.productId,
        (reservedByProduct.get(item.productId) ?? 0) + item.pickedQty,
      );
    }

    const lowStockCount = products.filter((product) => {
      if (product.reorderPoint === null) return false;
      const onHand = stockByProduct.get(product.id) ?? 0;
      const reserved = reservedByProduct.get(product.id) ?? 0;
      const available = onHand - reserved;
      return available <= product.reorderPoint;
    }).length;

    const alertBatches = await db.batch.findMany({
      where: { tenantId, expiryDate: { not: null } },
      select: { expiryDate: true },
    });
    const todayDate = new Date();
    const soon = new Date(todayDate);
    soon.setDate(todayDate.getDate() + 30);
    const expiringSoonCount = alertBatches.filter(
      (batch) =>
        batch.expiryDate &&
        batch.expiryDate >= todayDate &&
        batch.expiryDate <= soon,
    ).length;
    const expiredCount = alertBatches.filter(
      (batch) => batch.expiryDate && batch.expiryDate < todayDate,
    ).length;

    const invoices = await db.invoice.findMany({
      where: {
        tenantId,
        issuedAt: { gte: startDate, lte: endDate },
        ...(payerId ? { payerId } : {}),
      },
      include: {
        patient: true,
        items: true,
        debitNotes: true,
        payments: true,
      },
      orderBy: { issuedAt: "desc" },
    });

    const invoiceCount = invoices.length;
    const invoiceTotal = invoices.reduce(
      (sum, invoice) => sum + invoice.totalAmount,
      0,
    );
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

    const overdueInvoices = invoices.filter((invoice) => {
      if (!invoice.dueDate) return false;
      const debits = invoice.debitNotes.reduce(
        (acc, debit) => acc + debit.amount,
        0,
      );
      const payments = invoice.payments.reduce(
        (acc, payment) => acc + payment.amount,
        0,
      );
      const balance = Math.max(invoice.totalAmount - debits - payments, 0);
      return invoice.dueDate < todayDate && balance > 0;
    });

    const paymentTotals = await db.payment.aggregate({
      where: {
        tenantId,
        paidAt: { gte: startDate, lte: endDate },
        ...(payerId ? { invoice: { payerId } } : {}),
      },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const debitTotals = await db.debitNote.aggregate({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        ...(payerId ? { invoice: { payerId } } : {}),
      },
      _count: { _all: true },
      _sum: { amount: true },
    });

    const costsByPatient = new Map<
      string,
      { name: string; total: number }
    >();
    for (const invoice of invoices) {
      const existing = costsByPatient.get(invoice.patientId);
      const patientName = `${invoice.patient.lastName}, ${invoice.patient.firstName}`;
      if (!existing) {
        costsByPatient.set(invoice.patientId, {
          name: patientName,
          total: invoice.totalAmount,
        });
      } else {
        existing.total += invoice.totalAmount;
      }
    }
    const costRows = Array.from(costsByPatient.values()).sort(
      (a, b) => b.total - a.total,
    );

    const compliance = complianceGroups.reduce<
      Record<string, { total: number; completed: number }>
    >((acc, row) => {
      const userId = row.assignedUserId ?? "unassigned";
      if (!acc[userId]) {
        acc[userId] = { total: 0, completed: 0 };
      }
      acc[userId].total += row._count._all;
      if (row.status === "COMPLETED") {
        acc[userId].completed += row._count._all;
      }
      return acc;
    }, {});

    const userMap = new Map(users.map((user) => [user.id, user]));

    const visitOverdue = await db.visit.count({
      where: {
        tenantId,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        scheduledAt: { lt: todayDate },
      },
    });
    const deliveryOverdue = await db.delivery.count({
      where: {
        tenantId,
        status: { in: ["DRAFT", "PACKED", "IN_TRANSIT", "INCIDENT"] },
        scheduledAt: { lt: todayDate },
      },
    });
    const expiringAuthCount = await db.authorization.count({
      where: {
        tenantId,
        status: "ACTIVE",
        endDate: { gte: todayDate, lte: soon },
      },
    });

    return (
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">KPIs y control</h1>
            <p className="text-sm text-muted-foreground">
              Clinica, logistica y finanzas en un solo lugar.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/kpis/export?${exportParams.toString()}`}>
              Export CSV
            </Link>
          </Button>
        </div>

        <form className="grid gap-3 md:grid-cols-4" method="get">
          <Input
            name="start"
            type="date"
            defaultValue={formatDateInput(startDate)}
          />
          <Input
            name="end"
            type="date"
            defaultValue={formatDateInput(endDate)}
          />
          <select
            name="professionalId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            defaultValue={professionalId}
          >
            <option value="">Profesional (todos)</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name ?? user.email}
              </option>
            ))}
          </select>
          <select
            name="payerId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            defaultValue={payerId}
          >
            <option value="">Payer (todos)</option>
            {payers.map((payer) => (
              <option key={payer.id} value={payer.id}>
                {payer.name}
              </option>
            ))}
          </select>
          <Button type="submit" className="md:col-span-4">
            Aplicar filtros
          </Button>
        </form>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Alertas criticas</h2>
          <div className="grid gap-3 md:grid-cols-4">
            {[
              { label: "Visitas vencidas", value: visitOverdue },
              { label: "Entregas atrasadas", value: deliveryOverdue },
              { label: "Stock bajo", value: lowStockCount },
              { label: "Facturas vencidas", value: overdueInvoices.length },
              { label: "Autorizaciones por vencer", value: expiringAuthCount },
              { label: "Lotes vencidos", value: expiredCount },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="text-2xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">KPIs clinicos</h2>
          <div className="grid gap-3 md:grid-cols-4">
            {[
              { label: "Visitas programadas", value: visitsScheduled },
              { label: "Visitas completadas", value: visitsCompleted },
              { label: "Visitas canceladas", value: visitsCancelled },
              { label: "Visitas ausentes", value: visitsMissed },
              { label: "SLA visitas (%)", value: visitSlaPercent },
              { label: "Duracion promedio (min)", value: avgVisitMinutes },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="text-2xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Profesional</th>
                  <th className="px-3 py-2">Completadas</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">% Compliance</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(compliance).map(([userId, stats]) => {
                  const user = userMap.get(userId);
                  const percent =
                    stats.total > 0
                      ? Math.round((stats.completed / stats.total) * 100)
                      : 0;
                  return (
                    <tr key={userId} className="border-t">
                      <td className="px-3 py-2">
                        {user?.name ?? user?.email ?? "Sin asignar"}
                      </td>
                      <td className="px-3 py-2">{stats.completed}</td>
                      <td className="px-3 py-2">{stats.total}</td>
                      <td className="px-3 py-2">{percent}%</td>
                    </tr>
                  );
                })}
                {Object.keys(compliance).length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-4 text-sm text-muted-foreground"
                      colSpan={4}
                    >
                      Sin visitas asignadas.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">KPIs logistica</h2>
          <div className="grid gap-3 md:grid-cols-4">
            {[
              {
                label: "Entregas entregadas",
                value: deliveredInRange.length,
              },
              {
                label: "Entregas en transito",
                value: deliveryCountByStatus.get("IN_TRANSIT") ?? 0,
              },
              {
                label: "Entregas con incidente",
                value: deliveryCountByStatus.get("INCIDENT") ?? 0,
              },
              { label: "SLA entregas (%)", value: deliverySlaPercent },
              { label: "Stock bajo", value: lowStockCount },
              { label: "Lotes por vencer", value: expiringSoonCount },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="text-2xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {incidentGroups.map((group) => (
              <div key={group.cause} className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">{group.cause}</div>
                <div className="text-2xl font-semibold">{group._count._all}</div>
              </div>
            ))}
            {incidentGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin incidentes en el rango.
              </p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">KPIs financieros</h2>
          <div className="grid gap-3 md:grid-cols-4">
            {[
              { label: "Facturas emitidas", value: invoiceCount },
              {
                label: "Total facturado",
                value: invoiceTotal.toFixed(2),
              },
              {
                label: "Cobros",
                value: (paymentTotals._sum.amount ?? 0).toFixed(2),
              },
              {
                label: "Debitos",
                value: (debitTotals._sum.amount ?? 0).toFixed(2),
              },
              {
                label: "Saldo pendiente",
                value: outstandingTotal.toFixed(2),
              },
              {
                label: "Facturas vencidas",
                value: overdueInvoices.length,
              },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border p-4">
                <div className="text-xs text-muted-foreground">{item.label}</div>
                <div className="text-2xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Costos por paciente</h2>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Paciente</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {costRows.map((row) => (
                  <tr key={row.name} className="border-t">
                    <td className="px-3 py-2">{row.name}</td>
                    <td className="px-3 py-2">{row.total.toFixed(2)}</td>
                  </tr>
                ))}
                {costRows.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-4 text-sm text-muted-foreground"
                      colSpan={2}
                    >
                      Sin datos en el rango.
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
