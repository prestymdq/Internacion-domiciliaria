import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import { withTenant } from "@/lib/rls";

const DEFAULT_RANGE_DAYS = 30;
const VISIT_SLA_MINUTES = Number(process.env.VISIT_SLA_MINUTES ?? "30");
const DELIVERY_SLA_HOURS = Number(process.env.DELIVERY_SLA_HOURS ?? "4");

function parseDate(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

function toCsv(rows: Array<Array<string | number>>) {
  return rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return new Response("UNAUTHORIZED", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const professionalId = searchParams.get("professionalId") ?? "";
  const payerId = searchParams.get("payerId") ?? "";

  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(today.getDate() - DEFAULT_RANGE_DAYS);

  const startDate = parseDate(startParam, defaultStart);
  const endDate = parseDate(endParam, today);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  const data = await withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "ANALYTICS");
    if (!access.allowed) {
      return null;
    }

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
      where: { ...visitFilter, assignedUserId: { not: null } },
      _count: { _all: true },
    });
    const completedVisits = await db.visit.findMany({
      where: { ...visitFilter, status: "COMPLETED" },
      select: { scheduledAt: true, checkInAt: true },
    });

    const visitCountByStatus = new Map(
      visitGroups.map((group) => [group.status, group._count._all]),
    );
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

    const invoices = await db.invoice.findMany({
      where: {
        tenantId,
        issuedAt: { gte: startDate, lte: endDate },
        ...(payerId ? { payerId } : {}),
      },
      include: {
        patient: true,
        debitNotes: true,
        payments: true,
      },
    });

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
      return invoice.dueDate < today && balance > 0;
    });

    const costsByPatient = new Map<string, number>();
    for (const invoice of invoices) {
      const current = costsByPatient.get(invoice.patientId) ?? 0;
      costsByPatient.set(invoice.patientId, current + invoice.totalAmount);
    }

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

    const users = await db.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));

    return {
      visitCountByStatus,
      visitSlaPercent,
      deliverySlaPercent,
      incidentGroups,
      invoiceCount: invoices.length,
      invoiceTotal,
      outstandingTotal,
      overdueCount: overdueInvoices.length,
      compliance,
      userMap,
      costsByPatient,
    };
  });

  if (!data) {
    return new Response("FORBIDDEN", { status: 403 });
  }

  const rows: Array<Array<string | number>> = [];
  rows.push(["Section", "Metric", "Value"]);
  rows.push(["Clinical", "Visits scheduled", data.visitCountByStatus.get("SCHEDULED") ?? 0]);
  rows.push(["Clinical", "Visits completed", data.visitCountByStatus.get("COMPLETED") ?? 0]);
  rows.push(["Clinical", "Visits cancelled", data.visitCountByStatus.get("CANCELLED") ?? 0]);
  rows.push(["Clinical", "Visits missed", data.visitCountByStatus.get("MISSED") ?? 0]);
  rows.push(["Clinical", "Visit SLA percent", data.visitSlaPercent]);
  rows.push(["Logistics", "Delivery SLA percent", data.deliverySlaPercent]);
  rows.push(["Finance", "Invoices issued", data.invoiceCount]);
  rows.push(["Finance", "Total invoiced", data.invoiceTotal.toFixed(2)]);
  rows.push(["Finance", "Outstanding", data.outstandingTotal.toFixed(2)]);
  rows.push(["Finance", "Overdue invoices", data.overdueCount]);

  rows.push([]);
  rows.push(["Compliance by professional"]);
  rows.push(["Professional", "Completed", "Total", "Percent"]);
  Object.entries(data.compliance).forEach(([userId, stats]) => {
    const user = data.userMap.get(userId);
    const name = user?.name ?? user?.email ?? "Unassigned";
    const percent =
      stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    rows.push([name, stats.completed, stats.total, percent]);
  });

  rows.push([]);
  rows.push(["Incidents by cause"]);
  rows.push(["Cause", "Count"]);
  data.incidentGroups.forEach((group) => {
    rows.push([group.cause, group._count._all]);
  });

  rows.push([]);
  rows.push(["Costs per patient"]);
  rows.push(["PatientId", "Total"]);
  data.costsByPatient.forEach((total, patientId) => {
    rows.push([patientId, total.toFixed(2)]);
  });

  const csv = toCsv(rows);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=kpis.csv",
    },
  });
}
