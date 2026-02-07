import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const PAGE_SIZE = 20;

type SearchParams = {
  q?: string;
  page?: string;
};

const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dni: z.string().min(4),
  phone: z.string().optional(),
  address: z.string().optional(),
});

async function createPatient(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "CLINIC");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.PROFESIONAL,
    ]);

    const parsed = patientSchema.safeParse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      dni: formData.get("dni"),
      phone: formData.get("phone"),
      address: formData.get("address"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const patient = await db.patient.create({
      data: {
        tenantId: session.user.tenantId,
        ...parsed.data,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "patient.create",
      entityType: "Patient",
      entityId: patient.id,
      meta: { dni: patient.dni },
    });
  });

  revalidatePath("/patients");
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "CLINIC");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const query =
      typeof searchParams?.q === "string" ? searchParams.q.trim() : "";
    const pageNumber = Math.max(
      1,
      Number(searchParams?.page ?? "1") || 1,
    );

    const where = {
      tenantId,
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { dni: { contains: query } },
            ],
          }
        : {}),
    };

    const [patients, totalPatients] = await Promise.all([
      db.patient.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNumber - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.patient.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalPatients / PAGE_SIZE));
    const safePage = Math.min(pageNumber, totalPages);
    const baseParams = new URLSearchParams();
    if (query) baseParams.set("q", query);

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">
            Alta y seguimiento basico.
          </p>
        </div>

        <form action={createPatient} className="grid gap-3 md:grid-cols-5">
          <Input name="firstName" placeholder="Nombre" required />
          <Input name="lastName" placeholder="Apellido" required />
          <Input name="dni" placeholder="DNI" required />
          <Input name="phone" placeholder="Telefono" />
          <Input name="address" placeholder="Direccion" />
          <Button type="submit" className="md:col-span-5">
            Crear paciente
          </Button>
        </form>

        <form method="get" className="flex flex-wrap gap-2">
          <Input
            name="q"
            placeholder="Buscar por nombre o DNI"
            defaultValue={query}
            className="max-w-xs"
          />
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Paciente</th>
                <th className="px-3 py-2">DNI</th>
                <th className="px-3 py-2">Telefono</th>
                <th className="px-3 py-2">Direccion</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => (
                <tr key={patient.id} className="border-t">
                  <td className="px-3 py-2">
                    {patient.lastName}, {patient.firstName}
                  </td>
                  <td className="px-3 py-2">{patient.dni}</td>
                  <td className="px-3 py-2">{patient.phone ?? "-"}</td>
                  <td className="px-3 py-2">{patient.address ?? "-"}</td>
                </tr>
              ))}
              {patients.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-4 text-sm text-muted-foreground"
                    colSpan={4}
                  >
                    Sin pacientes aun.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div>
            Pagina {safePage} de {totalPages} ({totalPatients} pacientes)
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline" disabled={safePage <= 1}>
              <Link
                href={`?${new URLSearchParams({
                  ...Object.fromEntries(baseParams),
                  page: String(Math.max(1, safePage - 1)),
                }).toString()}`}
              >
                Anterior
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages}
            >
              <Link
                href={`?${new URLSearchParams({
                  ...Object.fromEntries(baseParams),
                  page: String(Math.min(totalPages, safePage + 1)),
                }).toString()}`}
              >
                Siguiente
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  });
}
