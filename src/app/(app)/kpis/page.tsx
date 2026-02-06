import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function KpisPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  const [visitGroups, users, incidentGroups] = await Promise.all([
    prisma.visit.groupBy({
      by: ["assignedUserId", "status"],
      where: { tenantId, assignedUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.incident.groupBy({
      by: ["cause"],
      where: { tenantId },
      _count: { _all: true },
    }),
  ]);

  const userMap = new Map(users.map((user) => [user.id, user]));

  const compliance = visitGroups.reduce<Record<string, { total: number; completed: number }>>(
    (acc, row) => {
      const userId = row.assignedUserId ?? "unassigned";
      if (!acc[userId]) {
        acc[userId] = { total: 0, completed: 0 };
      }
      acc[userId].total += row._count._all;
      if (row.status === "COMPLETED") {
        acc[userId].completed += row._count._all;
      }
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">KPIs</h1>
        <p className="text-sm text-muted-foreground">
          Compliance por persona e incidentes.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Compliance por profesional</h2>
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
                    Sin visitas asignadas aún.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Incidentes por causal</h2>
        <div className="grid gap-3 md:grid-cols-4">
          {incidentGroups.map((group) => (
            <div key={group.cause} className="rounded-lg border p-4">
              <div className="text-xs text-muted-foreground">{group.cause}</div>
              <div className="text-2xl font-semibold">{group._count._all}</div>
            </div>
          ))}
          {incidentGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin incidentes aún.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
