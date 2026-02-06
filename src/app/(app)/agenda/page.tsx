import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role, VisitStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { assertTenantModuleAccess, getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";

const visitSchema = z.object({
  episodeId: z.string().min(1),
  assignedUserId: z.string().optional(),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
});

const noteSchema = z.object({
  visitId: z.string().min(1),
  content: z.string().min(1),
});

const itemSchema = z.object({
  visitId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.string().min(1),
});

async function createVisit(formData: FormData) {
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

  const parsed = visitSchema.safeParse({
    episodeId: formData.get("episodeId"),
    assignedUserId: formData.get("assignedUserId"),
    scheduledAt: formData.get("scheduledAt"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const episode = await prisma.episode.findFirst({
    where: { id: parsed.data.episodeId, tenantId: session.user.tenantId },
  });

  if (!episode) {
    throw new Error("EPISODE_NOT_FOUND");
  }

  const visit = await prisma.visit.create({
    data: {
      tenantId: session.user.tenantId,
      patientId: episode.patientId,
      episodeId: episode.id,
      assignedUserId: parsed.data.assignedUserId || null,
      createdById: session.user.id,
      scheduledAt: new Date(parsed.data.scheduledAt),
      notes: parsed.data.notes ?? null,
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "visit.create",
    entityType: "Visit",
    entityId: visit.id,
  });

  revalidatePath("/agenda");
}

async function checkInVisit(formData: FormData) {
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

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) throw new Error("VALIDATION_ERROR");

  const visit = await prisma.visit.findFirst({
    where: { id: visitId, tenantId: session.user.tenantId },
  });

  if (!visit || visit.status !== "SCHEDULED") {
    throw new Error("INVALID_STATUS");
  }

  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: { status: VisitStatus.IN_PROGRESS, checkInAt: new Date() },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "visit.checkin",
    entityType: "Visit",
    entityId: updated.id,
  });

  revalidatePath("/agenda");
}

async function completeVisit(formData: FormData) {
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

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) throw new Error("VALIDATION_ERROR");

  const visit = await prisma.visit.findFirst({
    where: { id: visitId, tenantId: session.user.tenantId },
  });

  if (!visit || visit.status !== "IN_PROGRESS") {
    throw new Error("INVALID_STATUS");
  }

  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: { status: VisitStatus.COMPLETED, checkOutAt: new Date() },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "visit.complete",
    entityType: "Visit",
    entityId: updated.id,
  });

  revalidatePath("/agenda");
}

async function cancelVisit(formData: FormData) {
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

  const visitId = String(formData.get("visitId") ?? "");
  if (!visitId) throw new Error("VALIDATION_ERROR");

  const visit = await prisma.visit.findFirst({
    where: { id: visitId, tenantId: session.user.tenantId },
  });

  if (!visit || visit.status === "COMPLETED") {
    throw new Error("INVALID_STATUS");
  }

  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: { status: VisitStatus.CANCELLED },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "visit.cancel",
    entityType: "Visit",
    entityId: updated.id,
  });

  revalidatePath("/agenda");
}

async function addClinicalNote(formData: FormData) {
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

  const parsed = noteSchema.safeParse({
    visitId: formData.get("visitId"),
    content: formData.get("content"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const visit = await prisma.visit.findFirst({
    where: { id: parsed.data.visitId, tenantId: session.user.tenantId },
  });

  if (!visit) {
    throw new Error("VISIT_NOT_FOUND");
  }

  const note = await prisma.clinicalNote.create({
    data: {
      tenantId: session.user.tenantId,
      patientId: visit.patientId,
      episodeId: visit.episodeId,
      visitId: visit.id,
      authorId: session.user.id,
      content: parsed.data.content,
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "clinicalNote.create",
    entityType: "ClinicalNote",
    entityId: note.id,
  });

  revalidatePath("/agenda");
}

async function addVisitItem(formData: FormData) {
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

  const parsed = itemSchema.safeParse({
    visitId: formData.get("visitId"),
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const visit = await prisma.visit.findFirst({
    where: { id: parsed.data.visitId, tenantId: session.user.tenantId },
  });

  if (!visit) {
    throw new Error("VISIT_NOT_FOUND");
  }

  const item = await prisma.visitItem.create({
    data: {
      visitId: visit.id,
      productId: parsed.data.productId,
      quantity: Number(parsed.data.quantity),
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "visit.item.add",
    entityType: "VisitItem",
    entityId: item.id,
  });

  revalidatePath("/agenda");
}

export default async function AgendaPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  const access = await getTenantModuleAccess(tenantId, "CLINIC");
  if (!access.allowed) {
    return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
  }

  const [episodes, users, products, visits] = await Promise.all([
    prisma.episode.findMany({
      where: { tenantId, status: "ACTIVE" },
      include: { patient: true },
      orderBy: { startDate: "desc" },
    }),
    prisma.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    }),
    prisma.visit.findMany({
      where: { tenantId },
      include: {
        patient: true,
        assignedUser: true,
        clinicalNotes: { include: { author: true } },
        items: { include: { product: true } },
      },
      orderBy: { scheduledAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <p className="text-sm text-muted-foreground">
          Programación de visitas, notas clínicas y consumos.
        </p>
      </div>

      <form action={createVisit} className="grid gap-3 md:grid-cols-4">
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
        <select
          name="assignedUserId"
          className="h-10 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">Asignar profesional...</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name ?? user.email}
            </option>
          ))}
        </select>
        <Input name="scheduledAt" type="datetime-local" required />
        <Input name="notes" placeholder="Notas" />
        <Button type="submit" className="md:col-span-4">
          Programar visita
        </Button>
      </form>

      <div className="space-y-4">
        {visits.map((visit) => (
          <div key={visit.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  {visit.patient.lastName}, {visit.patient.firstName}
                </div>
                <div className="text-xs text-muted-foreground">
                  {visit.scheduledAt.toLocaleString("es-AR")} ·{" "}
                  {visit.assignedUser?.name ?? "Sin asignar"} ·{" "}
                  {visit.status}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {visit.status === "SCHEDULED" ? (
                  <form action={checkInVisit}>
                    <input type="hidden" name="visitId" value={visit.id} />
                    <Button size="sm" type="submit">
                      Check-in
                    </Button>
                  </form>
                ) : null}
                {visit.status === "IN_PROGRESS" ? (
                  <form action={completeVisit}>
                    <input type="hidden" name="visitId" value={visit.id} />
                    <Button size="sm" variant="secondary" type="submit">
                      Completar
                    </Button>
                  </form>
                ) : null}
                {visit.status !== "COMPLETED" ? (
                  <form action={cancelVisit}>
                    <input type="hidden" name="visitId" value={visit.id} />
                    <Button size="sm" variant="outline" type="submit">
                      Cancelar
                    </Button>
                  </form>
                ) : null}
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <form action={addClinicalNote} className="rounded-md border p-3">
                <input type="hidden" name="visitId" value={visit.id} />
                <Textarea name="content" placeholder="Nota clínica" required />
                <Button size="sm" type="submit" className="mt-2">
                  Agregar nota
                </Button>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {visit.clinicalNotes.map((note) => (
                    <li key={note.id}>
                      {note.author.name ?? note.author.email}: {note.content}
                    </li>
                  ))}
                  {visit.clinicalNotes.length === 0 ? (
                    <li>Sin notas aún.</li>
                  ) : null}
                </ul>
              </form>

              <form action={addVisitItem} className="rounded-md border p-3">
                <input type="hidden" name="visitId" value={visit.id} />
                <select
                  name="productId"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  required
                >
                  <option value="">Producto consumido...</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
                <Input
                  name="quantity"
                  type="number"
                  min="1"
                  placeholder="Cantidad"
                  className="mt-2"
                  required
                />
                <Button size="sm" type="submit" className="mt-2">
                  Registrar consumo
                </Button>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {visit.items.map((item) => (
                    <li key={item.id}>
                      {item.product.name} x {item.quantity}
                    </li>
                  ))}
                  {visit.items.length === 0 ? (
                    <li>Sin consumos aún.</li>
                  ) : null}
                </ul>
              </form>
            </div>
          </div>
        ))}
        {visits.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin visitas aún.</p>
        ) : null}
      </div>
    </div>
  );
}
