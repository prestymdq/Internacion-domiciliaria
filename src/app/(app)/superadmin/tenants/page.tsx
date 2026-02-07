import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { withSuperadmin } from "@/lib/rls";

export default async function SuperadminTenantsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return <p>Sin sesión.</p>;
  }
  if (session.user.role !== "SUPERADMIN") {
    return (
      <p className="text-sm text-muted-foreground">
        Solo superadmin puede acceder.
      </p>
    );
  }

  const tenants = await withSuperadmin((db) =>
    db.tenant.findMany({
      orderBy: { createdAt: "desc" },
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <p className="text-sm text-muted-foreground">
          Monitoreo básico de clientes.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Trial</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id} className="border-t">
                <td className="px-3 py-2">{tenant.name}</td>
                <td className="px-3 py-2">{tenant.slug}</td>
                <td className="px-3 py-2">{tenant.plan}</td>
                <td className="px-3 py-2">{tenant.status}</td>
                <td className="px-3 py-2">
                  {tenant.trialEndsAt
                    ? tenant.trialEndsAt.toLocaleDateString("es-AR")
                    : "-"}
                </td>
              </tr>
            ))}
            {tenants.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-sm text-muted-foreground"
                  colSpan={5}
                >
                  Sin tenants aún.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
