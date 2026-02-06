import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import NavLink from "@/components/app/nav-link";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";

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
    ? await prisma.tenant.findUnique({
        where: { id: session.user.tenantId },
      })
    : null;

  const isSuperAdmin = session.user.role === "SUPERADMIN";

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl gap-6 px-4 py-6">
        <aside className="hidden w-64 flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm md:flex">
          <div className="space-y-1">
            <p className="text-xs uppercase text-muted-foreground">Tenant</p>
            <p className="text-sm font-semibold">
              {tenant?.name ?? "Plataforma"}
            </p>
          </div>
          <nav className="flex flex-col gap-1">
            <NavLink href="/dashboard" label="Dashboard" />
            <NavLink href="/patients" label="Pacientes" />
            <NavLink href="/episodes" label="Episodios" />
            <NavLink href="/agenda" label="Agenda" />
            <NavLink href="/inventory/products" label="Productos" />
            <NavLink href="/inventory/warehouses" label="Depósitos" />
            <NavLink href="/inventory/stock" label="Movimientos" />
            <NavLink href="/logistics/orders" label="Órdenes" />
            <NavLink href="/logistics/picklists" label="Picklists" />
            <NavLink href="/logistics/deliveries" label="Entregas" />
            <NavLink href="/payers" label="Obras sociales" />
            <NavLink href="/authorizations" label="Autorizaciones" />
            <NavLink href="/kpis" label="KPIs" />
            {isSuperAdmin ? (
              <>
                <NavLink href="/onboarding" label="Onboarding" />
                <NavLink href="/superadmin/tenants" label="Superadmin" />
              </>
            ) : null}
          </nav>
          <div className="mt-auto space-y-2">
            <Button asChild variant="outline">
              <Link href="/billing">Billing</Link>
            </Button>
            <SignOutButton />
          </div>
        </aside>
        <div className="flex flex-1 flex-col gap-6">
          <header className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 shadow-sm md:hidden">
            <div className="text-sm font-semibold">
              {tenant?.name ?? "Plataforma"}
            </div>
            <SignOutButton compact />
          </header>
          <main className="flex-1 rounded-xl border bg-card p-6 shadow-sm">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
