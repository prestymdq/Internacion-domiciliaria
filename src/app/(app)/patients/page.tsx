import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { assertTenantModuleAccess, getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";

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
  await assertTenantModuleAccess(session.user.tenantId, "CLINIC");
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

  const patient = await prisma.patient.create({
    data: {
      tenantId: session.user.tenantId,
      ...parsed.data,
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "patient.create",
    entityType: "Patient",
    entityId: patient.id,
    meta: { dni: patient.dni },
  });

  revalidatePath("/patients");
}

export default async function PatientsPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  const access = await getTenantModuleAccess(tenantId, "CLINIC");
  if (!access.allowed) {
    return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
  }

  const patients = await prisma.patient.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pacientes</h1>
        <p className="text-sm text-muted-foreground">
          Alta y seguimiento básico.
        </p>
      </div>

      <form action={createPatient} className="grid gap-3 md:grid-cols-5">
        <Input name="firstName" placeholder="Nombre" required />
        <Input name="lastName" placeholder="Apellido" required />
        <Input name="dni" placeholder="DNI" required />
        <Input name="phone" placeholder="Teléfono" />
        <Input name="address" placeholder="Dirección" />
        <Button type="submit" className="md:col-span-5">
          Crear paciente
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Paciente</th>
              <th className="px-3 py-2">DNI</th>
              <th className="px-3 py-2">Teléfono</th>
              <th className="px-3 py-2">Dirección</th>
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
                  Sin pacientes aún.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
