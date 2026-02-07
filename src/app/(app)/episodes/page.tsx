import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const episodeSchema = z.object({
  patientId: z.string().min(1),
  startDate: z.string().min(1),
  diagnosis: z.string().optional(),
  notes: z.string().optional(),
});

const carePlanSchema = z.object({
  episodeId: z.string().min(1),
  summary: z.string().optional(),
  frequency: z.string().optional(),
  objectives: z.string().optional(),
});

const workflowStageSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.string().optional(),
  isTerminal: z.string().optional(),
});

const stageUpdateSchema = z.object({
  episodeId: z.string().min(1),
  workflowStageId: z.string().optional(),
});

async function createEpisode(formData: FormData) {
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

    const parsed = episodeSchema.safeParse({
      patientId: formData.get("patientId"),
      startDate: formData.get("startDate"),
      diagnosis: formData.get("diagnosis"),
      notes: formData.get("notes"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const defaultStage = await db.episodeWorkflowStage.findFirst({
      where: { tenantId: session.user.tenantId },
      orderBy: { sortOrder: "asc" },
    });

    const episode = await db.episode.create({
      data: {
        tenantId: session.user.tenantId,
        patientId: parsed.data.patientId,
        startDate: new Date(parsed.data.startDate),
        diagnosis: parsed.data.diagnosis ?? null,
        notes: parsed.data.notes ?? null,
        workflowStageId: defaultStage?.id ?? null,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "episode.create",
      entityType: "Episode",
      entityId: episode.id,
    });
  });

  revalidatePath("/episodes");
}

async function upsertCarePlan(formData: FormData) {
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

    const parsed = carePlanSchema.safeParse({
      episodeId: formData.get("episodeId"),
      summary: formData.get("summary"),
      frequency: formData.get("frequency"),
      objectives: formData.get("objectives"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const episode = await db.episode.findFirst({
      where: { id: parsed.data.episodeId, tenantId: session.user.tenantId },
    });

    if (!episode) {
      throw new Error("EPISODE_NOT_FOUND");
    }

    const objectives = (parsed.data.objectives ?? "")
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    const carePlan = await db.episodeCarePlan.upsert({
      where: { episodeId: episode.id },
      update: {
        summary: parsed.data.summary?.trim() || null,
        frequency: parsed.data.frequency?.trim() || null,
        objectives: objectives.length > 0 ? objectives : null,
      },
      create: {
        tenantId: session.user.tenantId,
        episodeId: episode.id,
        summary: parsed.data.summary?.trim() || null,
        frequency: parsed.data.frequency?.trim() || null,
        objectives: objectives.length > 0 ? objectives : null,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "episode.care_plan.upsert",
      entityType: "EpisodeCarePlan",
      entityId: carePlan.id,
    });
  });

  revalidatePath("/episodes");
}

async function createWorkflowStage(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "CLINIC");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.COORDINACION]);

    const parsed = workflowStageSchema.safeParse({
      name: formData.get("name"),
      sortOrder: formData.get("sortOrder"),
      isTerminal: formData.get("isTerminal"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const sortOrder = Number(parsed.data.sortOrder ?? 0);
    const stage = await db.episodeWorkflowStage.create({
      data: {
        tenantId: session.user.tenantId,
        name: parsed.data.name.trim(),
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        isTerminal: parsed.data.isTerminal === "on",
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "episode.workflow_stage.create",
      entityType: "EpisodeWorkflowStage",
      entityId: stage.id,
    });
  });

  revalidatePath("/episodes");
}

async function setEpisodeStage(formData: FormData) {
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

    const parsed = stageUpdateSchema.safeParse({
      episodeId: formData.get("episodeId"),
      workflowStageId: formData.get("workflowStageId"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const episode = await db.episode.findFirst({
      where: { id: parsed.data.episodeId, tenantId: session.user.tenantId },
    });
    if (!episode) {
      throw new Error("EPISODE_NOT_FOUND");
    }

    let stageId: string | null = null;
    if (parsed.data.workflowStageId) {
      const stage = await db.episodeWorkflowStage.findFirst({
        where: {
          id: parsed.data.workflowStageId,
          tenantId: session.user.tenantId,
        },
      });
      if (!stage) {
        throw new Error("STAGE_NOT_FOUND");
      }
      stageId = stage.id;
    }

    const updated = await db.episode.update({
      where: { id: episode.id },
      data: { workflowStageId: stageId },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "episode.workflow_stage.update",
      entityType: "Episode",
      entityId: updated.id,
      meta: { workflowStageId: stageId },
    });
  });

  revalidatePath("/episodes");
}

async function dischargeEpisode(formData: FormData) {
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

    const episodeId = String(formData.get("episodeId") ?? "");
    if (!episodeId) {
      throw new Error("VALIDATION_ERROR");
    }

    const episode = await db.episode.update({
      where: { id: episodeId, tenantId: session.user.tenantId },
      data: {
        status: "DISCHARGED",
        endDate: new Date(),
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "episode.discharge",
      entityType: "Episode",
      entityId: episode.id,
    });
  });

  revalidatePath("/episodes");
}

export default async function EpisodesPage() {
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

    const patients = await db.patient.findMany({
      where: { tenantId },
      orderBy: { lastName: "asc" },
    });
    const workflowStages = await db.episodeWorkflowStage.findMany({
      where: { tenantId },
      orderBy: { sortOrder: "asc" },
    });
    const episodes = await db.episode.findMany({
      where: { tenantId },
      include: { patient: true, carePlan: true, workflowStage: true },
      orderBy: { createdAt: "desc" },
    });

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
          <Input name="diagnosis" placeholder="DiagnÃ³stico" />
          <Textarea name="notes" placeholder="Notas" />
          <Button type="submit" className="md:col-span-4">
            Crear episodio
          </Button>
        </form>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">Workflow del episodio</h2>
            <p className="text-xs text-muted-foreground">
              ConfigurÃ¡ los estados operativos del episodio.
            </p>
            <form action={createWorkflowStage} className="mt-3 grid gap-2">
              <Input name="name" placeholder="Estado" required />
              <Input
                name="sortOrder"
                type="number"
                placeholder="Orden (0, 10, 20...)"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input name="isTerminal" type="checkbox" />
                Terminal (egreso / cierre)
              </label>
              <Button type="submit" size="sm">
                Agregar estado
              </Button>
            </form>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {workflowStages.map((stage) => (
                <li key={stage.id}>
                  {stage.name} â orden {stage.sortOrder}
                  {stage.isTerminal ? " (terminal)" : ""}
                </li>
              ))}
              {workflowStages.length === 0 ? (
                <li>Sin estados configurados.</li>
              ) : null}
            </ul>
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">Plan de cuidado</h2>
            <p className="text-xs text-muted-foreground">
              Objetivos y frecuencia por episodio.
            </p>
            <form action={upsertCarePlan} className="mt-3 grid gap-2">
              <select
                name="episodeId"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                required
              >
                <option value="">Episodio...</option>
                {episodes.map((episode) => (
                  <option key={episode.id} value={episode.id}>
                    {episode.patient.lastName}, {episode.patient.firstName}
                  </option>
                ))}
              </select>
              <Input name="summary" placeholder="Resumen del plan" />
              <Input name="frequency" placeholder="Frecuencia (ej: 3/semana)" />
              <Textarea
                name="objectives"
                placeholder="Objetivos (uno por lÃ­nea o separados por coma)"
              />
              <Button type="submit" size="sm">
                Guardar plan
              </Button>
            </form>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Paciente</th>
                <th className="px-3 py-2">Workflow</th>
                <th className="px-3 py-2">Plan de cuidado</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Inicio</th>
                <th className="px-3 py-2">Fin</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((episode) => (
                <tr key={episode.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    {episode.patient.lastName}, {episode.patient.firstName}
                  </td>
                  <td className="px-3 py-2">
                    <form action={setEpisodeStage} className="flex gap-2">
                      <input type="hidden" name="episodeId" value={episode.id} />
                      <select
                        name="workflowStageId"
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        defaultValue={episode.workflowStage?.id ?? ""}
                      >
                        <option value="">Sin estado</option>
                        {workflowStages.map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="outline" type="submit">
                        Actualizar
                      </Button>
                    </form>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {episode.carePlan ? (
                      <div className="space-y-1">
                        <div>{episode.carePlan.summary ?? "Sin resumen"}</div>
                        <div>
                          Frecuencia:{" "}
                          {episode.carePlan.frequency ?? "Sin definir"}
                        </div>
                        <div>
                          Objetivos:{" "}
                          {Array.isArray(episode.carePlan.objectives)
                            ? episode.carePlan.objectives.length
                            : 0}
                        </div>
                      </div>
                    ) : (
                      "Sin plan"
                    )}
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
                        <input
                          type="hidden"
                          name="episodeId"
                          value={episode.id}
                        />
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
                    colSpan={7}
                  >
                    Sin episodios aÃºn.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  });
}
