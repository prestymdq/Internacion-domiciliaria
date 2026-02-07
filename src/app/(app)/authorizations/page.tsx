import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role, AuthorizationStatus } from "@prisma/client";
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

    const requirements = await db.payerRequirement.findMany({
      where: { tenantId: session.user.tenantId, payerId: parsed.data.payerId },
    });

    const authorization = await db.authorization.create({
      data: {
        tenantId: session.user.tenantId,
        payerId: parsed.data.payerId,
        planId: parsed.data.planId || null,
        patientId: parsed.data.patientId,
        episodeId: parsed.data.episodeId || null,
        number: parsed.data.number,
        status: AuthorizationStatus.PENDING,
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
          Números de autorización y requisitos adjuntos.
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
        <Input name="number" placeholder="Nro autorización" required />
        <Input name="startDate" type="date" required />
        <Input name="endDate" type="date" />
        <Input name="limitAmount" placeholder="Tope $ (opcional)" />
        <Input name="limitUnits" placeholder="Tope unidades (opcional)" />
        <Textarea name="notes" placeholder="Notas" />
        <Button type="submit" className="md:col-span-4">
          Crear autorización
        </Button>
      </form>

      <div className="space-y-4">
        {authorizations.map((authorization) => (
          <div key={authorization.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">
                  {authorization.payer.name} · {authorization.number}
                </div>
                <div className="text-xs text-muted-foreground">
                  {authorization.patient.lastName},{" "}
                  {authorization.patient.firstName} ·{" "}
                  {authorization.status}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {authorization.startDate.toLocaleDateString("es-AR")}
                {authorization.endDate
                  ? ` → ${authorization.endDate.toLocaleDateString("es-AR")}`
                  : ""}
              </div>
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
        ))}
        {authorizations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin autorizaciones aún.
          </p>
        ) : null}
      </div>
    </div>
    );
  });
}
