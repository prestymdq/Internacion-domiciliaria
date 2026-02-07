import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import NavLink from "@/components/app/nav-link";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { withTenant } from "@/lib/rls";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const tenant = session.user.tenantId
    ? await withTenant(session.user.tenantId, (db) =>
        db.tenant.findUnique({
          where: { id: session.user.tenantId },
        }),
      )
    : null;

  const isSuperAdmin = session.user.role === "SUPERADMIN";

  return (
    <div className="min-h-screen">
      <div className="flex min-h-screen w-full gap-6 px-4 py-6">
        <aside className="hidden w-72 flex-col gap-6 rounded-3xl border border-white/70 bg-white/70 p-5 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] backdrop-blur md:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              ID
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Plataforma
              </p>
              <p className="text-sm font-semibold">Internacion Domiciliaria</p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/60 bg-background/70 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Tenant
            </p>
            <p className="text-sm font-semibold">{tenant?.name ?? "Plataforma"}</p>
            <p className="mt-2 inline-flex rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
              {tenant?.status ?? "GLOBAL"}
            </p>
          </div>

          <nav className="flex flex-1 flex-col gap-2">
            <NavLink href="/dashboard" label="Dashboard" />
            <NavLink href="/patients" label="Pacientes" />
            <NavLink href="/episodes" label="Episodios" />
            <NavLink href="/agenda" label="Agenda" />
            <div className="pt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Operacion
            </div>
            <NavLink href="/inventory/products" label="Productos" />
            <NavLink href="/inventory/warehouses" label="Depositos" />
            <NavLink href="/inventory/stock" label="Movimientos" />
            <NavLink href="/logistics/orders" label="Ordenes" />
            <NavLink href="/logistics/picklists" label="Picklists" />
            <NavLink href="/logistics/deliveries" label="Entregas" />
            <div className="pt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Financiero
            </div>
            <NavLink href="/payers" label="Obras sociales" />
            <NavLink href="/authorizations" label="Autorizaciones" />
            <NavLink href="/billing" label="Billing" />
            <NavLink href="/kpis" label="KPIs" />
            {isSuperAdmin ? (
              <>
                <div className="pt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Admin
                </div>
                <NavLink href="/onboarding" label="Onboarding" />
                <NavLink href="/superadmin/tenants" label="Superadmin" />
              </>
            ) : null}
          </nav>

          <div className="mt-auto space-y-2">
            <Button asChild variant="secondary" className="w-full">
              <Link href="/billing">Administrar plan</Link>
            </Button>
            <SignOutButton />
          </div>
        </aside>

        <div className="flex flex-1 flex-col gap-6">
          <header className="flex items-center justify-between rounded-2xl border border-white/70 bg-white/70 px-4 py-3 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] backdrop-blur md:hidden">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Tenant
              </p>
              <p className="text-sm font-semibold">{tenant?.name ?? "Plataforma"}</p>
            </div>
            <SignOutButton compact />
          </header>

          <main className="flex-1 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] backdrop-blur">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
