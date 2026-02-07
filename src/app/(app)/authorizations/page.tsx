import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { AuthorizationStatus, RequirementStatus, Role } from "@prisma/client";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { withTenant } from "@/lib/rls";

const authorizationSchema = z.object({
  payerId: z.string().min(1),
  planId: z.string().optional(),
  patientId: z.string().min(1),
  episodeId: z.string().optional(),
  number: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  limitAmount: z.string().optional(),
  limitUnits: z.string().optional(),
  notes: z.string().optional(),
});

const authorizationStatusSchema = z.object({
  authorizationId: z.string().min(1),
  status: z.nativeEnum(AuthorizationStatus),
});

const requirementStatusSchema = z.object({
  requirementId: z.string().min(1),
  status: z.nativeEnum(RequirementStatus),
});

async function createAuthorization(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "AUTHORIZATIONS");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.FACTURACION,
    ]);

    const parsed = authorizationSchema.safeParse({
      payerId: formData.get("payerId"),
      planId: formData.get("planId"),
      patientId: formData.get("patientId"),
      episodeId: formData.get("episodeId"),
      number: formData.get("number"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      limitAmount: formData.get("limitAmount"),
      limitUnits: formData.get("limitUnits"),
      notes: formData.get("notes"),
    });

    if (!parsed.success) throw new Error("VALIDATION_ERROR");

    const payer = await db.payer.findFirst({
      where: { id: parsed.data.payerId, tenantId: session.user.tenantId },
    });
    if (!payer) {
      throw new Error("PAYER_NOT_FOUND");
    }

    let planId: string | null = parsed.data.planId || null;
    if (planId) {
      const plan = await db.payerPlan.findFirst({
        where: { id: planId, tenantId: session.user.tenantId },
      });
      if (!plan || plan.payerId !== payer.id) {
        throw new Error("PLAN_PAYER_MISMATCH");
      }
    }

    const patient = await db.patient.findFirst({
      where: { id: parsed.data.patientId, tenantId: session.user.tenantId },
    });
    if (!patient) {
      throw new Error("PATIENT_NOT_FOUND");
    }

    let episodeId: string | null = parsed.data.episodeId || null;
    if (episodeId) {
      const episode = await db.episode.findFirst({
        where: { id: episodeId, tenantId: session.user.tenantId },
      });
      if (!episode) {
        throw new Error("EPISODE_NOT_FOUND");
      }
      if (episode.patientId !== patient.id) {
        throw new Error("EPISODE_PATIENT_MISMATCH");
      }
    }

    const requirements = await db.payerRequirement.findMany({
      where: { tenantId: session.user.tenantId, payerId: parsed.data.payerId },
    });

    const authorization = await db.authorization.create({
      data: {
        tenantId: session.user.tenantId,
        payerId: payer.id,
        planId,
        patientId: patient.id,
        episodeId,
        number: parsed.data.number,
        status:
          requirements.length === 0
            ? AuthorizationStatus.ACTIVE
            : AuthorizationStatus.PENDING,
        startDate: new Date(parsed.data.startDate),
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        limitAmount: parsed.data.limitAmount
          ? Number(parsed.data.limitAmount)
          : null,
        limitUnits: parsed.data.limitUnits
          ? Number(parsed.data.limitUnits)
          : null,
        notes: parsed.data.notes ?? null,
        requirements: {
          create: requirements.map((req) => ({
            tenantId: session.user.tenantId,
            requirementId: req.id,
            status: "PENDING",
          })),
        },
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "authorization.create",
      entityType: "Authorization",
      entityId: authorization.id,
    });
  });

  revalidatePath("/authorizations");
}

async function updateAuthorizationStatus(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "AUTHORIZATIONS");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.FACTURACION,
    ]);

    const parsed = authorizationStatusSchema.safeParse({
      authorizationId: formData.get("authorizationId"),
      status: formData.get("status"),
    });

    if (!parsed.success) throw new Error("VALIDATION_ERROR");

    const updated = await db.authorization.update({
      where: {
        id: parsed.data.authorizationId,
        tenantId: session.user.tenantId,
      },
      data: { status: parsed.data.status },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "authorization.status.update",
      entityType: "Authorization",
      entityId: updated.id,
      meta: { status: parsed.data.status },
    });
  });

  revalidatePath("/authorizations");
}

async function updateRequirementStatus(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "AUTHORIZATIONS");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.FACTURACION,
    ]);

    const parsed = requirementStatusSchema.safeParse({
      requirementId: formData.get("requirementId"),
      status: formData.get("status"),
    });

    if (!parsed.success) throw new Error("VALIDATION_ERROR");

    const updated = await db.authorizationRequirement.update({
      where: {
        id: parsed.data.requirementId,
        tenantId: session.user.tenantId,
      },
      data: { status: parsed.data.status },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "authorization.requirement.status.update",
      entityType: "AuthorizationRequirement",
      entityId: updated.id,
      meta: { status: parsed.data.status },
    });
  });

  revalidatePath("/authorizations");
}

export default async function AuthorizationsPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "AUTHORIZATIONS");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const payers = await db.payer.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const plans = await db.payerPlan.findMany({
      where: { tenantId },
      include: { payer: true },
      orderBy: { name: "asc" },
    });
    const patients = await db.patient.findMany({
      where: { tenantId },
      orderBy: { lastName: "asc" },
    });
    const episodes = await db.episode.findMany({
      where: { tenantId, status: "ACTIVE" },
      include: { patient: true },
      orderBy: { startDate: "desc" },
    });
    const authorizations = await db.authorization.findMany({
      where: { tenantId },
      include: {
        payer: true,
        plan: true,
        patient: true,
        episode: true,
        requirements: { include: { requirement: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Autorizaciones</h1>
          <p className="text-sm text-muted-foreground">
            Numeros de autorizacion y requisitos adjuntos.
          </p>
        </div>

        <form action={createAuthorization} className="grid gap-3 md:grid-cols-4">
          <select
            name="payerId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            required
          >
            <option value="">Obra social...</option>
            {payers.map((payer) => (
              <option key={payer.id} value={payer.id}>
                {payer.name}
              </option>
            ))}
          </select>
          <select
            name="planId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Plan (opcional)...</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.payer.name} - {plan.name}
              </option>
            ))}
          </select>
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
          <select
            name="episodeId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
          >
            <option value="">Episodio (opcional)...</option>
            {episodes.map((episode) => (
              <option key={episode.id} value={episode.id}>
                {episode.patient.lastName}, {episode.patient.firstName}
              </option>
            ))}
          </select>
          <Input name="number" placeholder="Nro autorizacion" required />
          <Input name="startDate" type="date" required />
          <Input name="endDate" type="date" />
          <Input name="limitAmount" placeholder="Tope $ (opcional)" />
          <Input name="limitUnits" placeholder="Tope unidades (opcional)" />
          <Textarea name="notes" placeholder="Notas" />
          <Button type="submit" className="md:col-span-4">
            Crear autorizacion
          </Button>
        </form>

        <div className="space-y-4">
          {authorizations.map((authorization) => {
            const requirementsPending = authorization.requirements.filter(
              (req) =>
                req.status !== "SUBMITTED" && req.status !== "APPROVED",
            ).length;
            return (
              <div key={authorization.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">
                      {authorization.payer.name} - {authorization.number}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {authorization.patient.lastName},{" "}
                      {authorization.patient.firstName} - {authorization.status}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {authorization.startDate.toLocaleDateString("es-AR")}
                    {authorization.endDate
                      ? ` -> ${authorization.endDate.toLocaleDateString("es-AR")}`
                      : ""}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Requisitos pendientes: {requirementsPending}
                  </span>
                  <form action={updateAuthorizationStatus} className="flex gap-2">
                    <input
                      type="hidden"
                      name="authorizationId"
                      value={authorization.id}
                    />
                    <select
                      name="status"
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                      defaultValue={authorization.status}
                    >
                      {Object.values(AuthorizationStatus).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" type="submit">
                      Guardar
                    </Button>
                  </form>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {authorization.requirements.map((req) => (
                    <div key={req.id} className="rounded-md border p-3">
                      <div className="text-sm font-medium">
                        {req.requirement.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Estado: {req.status}
                      </div>
                      {req.fileName ? (
                        <div className="text-xs text-muted-foreground">
                          Archivo: {req.fileName}
                        </div>
                      ) : null}
                      <form
                        action={updateRequirementStatus}
                        className="mt-2 flex items-center gap-2"
                      >
                        <input type="hidden" name="requirementId" value={req.id} />
                        <select
                          name="status"
                          className="h-8 rounded-md border bg-background px-2 text-xs"
                          defaultValue={req.status}
                        >
                          {Object.values(RequirementStatus).map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                        <Button size="sm" variant="outline" type="submit">
                          Guardar
                        </Button>
                      </form>
                      <form
                        action={`/api/authorizations/requirements/${req.id}/upload`}
                        method="post"
                        encType="multipart/form-data"
                        className="mt-2 flex flex-col gap-2"
                      >
                        <input type="file" name="file" required />
                        <Button size="sm" type="submit">
                          Subir adjunto
                        </Button>
                      </form>
                    </div>
                  ))}
                  {authorization.requirements.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Sin requisitos configurados.
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
          {authorizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin autorizaciones aun.
            </p>
          ) : null}
        </div>
      </div>
    );
  });
}
