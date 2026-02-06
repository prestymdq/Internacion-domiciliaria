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
import { Textarea } from "@/components/ui/textarea";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";

const episodeSchema = z.object({
  patientId: z.string().min(1),
  startDate: z.string().min(1),
  diagnosis: z.string().optional(),
  notes: z.string().optional(),
});

async function createEpisode(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }

  assertRole(session.user.role, [
    Role.ADMIN_TENANT,
    Role.COORDINACION,
    Role.PROFESIONAL,
  ]);

  const parsed = episodeSchema.safeParse({
    patientId: formData.get("patientId"),
    startDate: formData.get("startDate"),
    diagnosis: formData.get("diagnosis"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const episode = await prisma.episode.create({
    data: {
      tenantId: session.user.tenantId,
      patientId: parsed.data.patientId,
      startDate: new Date(parsed.data.startDate),
      diagnosis: parsed.data.diagnosis ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "episode.create",
    entityType: "Episode",
    entityId: episode.id,
  });

  revalidatePath("/episodes");
}

async function dischargeEpisode(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  assertRole(session.user.role, [
    Role.ADMIN_TENANT,
    Role.COORDINACION,
    Role.PROFESIONAL,
  ]);

  const episodeId = String(formData.get("episodeId") ?? "");
  if (!episodeId) {
    throw new Error("VALIDATION_ERROR");
  }

  const episode = await prisma.episode.update({
    where: { id: episodeId, tenantId: session.user.tenantId },
    data: {
      status: "DISCHARGED",
      endDate: new Date(),
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "episode.discharge",
    entityType: "Episode",
    entityId: episode.id,
  });

  revalidatePath("/episodes");
}

export default async function EpisodesPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  const access = await getTenantModuleAccess(tenantId, "CLINIC");
  if (!access.allowed) {
    return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
  }

  const [patients, episodes] = await Promise.all([
    prisma.patient.findMany({
      where: { tenantId },
      orderBy: { lastName: "asc" },
    }),
    prisma.episode.findMany({
      where: { tenantId },
      include: { patient: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Episodios</h1>
        <p className="text-sm text-muted-foreground">
          Internaciones domiciliarias activas.
        </p>
      </div>

      <form action={createEpisode} className="grid gap-3 md:grid-cols-4">
        <select
          name="patientId"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          required
        >
          <option value="">Paciente...</option>
          {patients.map((patient) => (
            <option key={patient.id} value={patient.id}>
              {patient.lastName}, {patient.firstName}
            </option>
          ))}
        </select>
        <Input name="startDate" type="date" required />
        <Input name="diagnosis" placeholder="Diagnóstico" />
        <Textarea name="notes" placeholder="Notas" />
        <Button type="submit" className="md:col-span-4">
          Crear episodio
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Paciente</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Inicio</th>
              <th className="px-3 py-2">Fin</th>
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {episodes.map((episode) => (
              <tr key={episode.id} className="border-t">
                <td className="px-3 py-2">
                  {episode.patient.lastName}, {episode.patient.firstName}
                </td>
                <td className="px-3 py-2">{episode.status}</td>
                <td className="px-3 py-2">
                  {episode.startDate.toLocaleDateString("es-AR")}
                </td>
                <td className="px-3 py-2">
                  {episode.endDate
                    ? episode.endDate.toLocaleDateString("es-AR")
                    : "-"}
                </td>
                <td className="px-3 py-2">
                  {episode.status === "ACTIVE" ? (
                    <form action={dischargeEpisode}>
                      <input type="hidden" name="episodeId" value={episode.id} />
                      <Button size="sm" variant="outline" type="submit">
                        Dar alta
                      </Button>
                    </form>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
            {episodes.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-sm text-muted-foreground"
                  colSpan={5}
                >
                  Sin episodios aún.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
