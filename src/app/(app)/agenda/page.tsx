import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role, VisitStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const defaultChecklistItems = [
  { key: "patient_identity", label: "Identificacion del paciente" },
  { key: "hand_hygiene", label: "Higiene de manos" },
  { key: "vitals", label: "Signos vitales registrados" },
  { key: "intervention", label: "Intervencion realizada" },
  { key: "consumables", label: "Consumibles registrados" },
  { key: "next_visit", label: "Proxima visita coordinada" },
];

const visitSchema = z.object({
  episodeId: z.string().min(1),
  assignedUserId: z.string().optional(),
  scheduledAt: z.string().min(1),
  notes: z.string().optional(),
});

const noteSchema = z.object({
  visitId: z.string().min(1),
  summary: z.string().min(1),
  subjective: z.string().optional(),
  objective: z.string().optional(),
  assessment: z.string().optional(),
  plan: z.string().optional(),
});

const checklistSchema = z.object({
  checklistId: z.string().min(1),
  completed: z.enum(["true", "false"]),
});

const itemSchema = z.object({
  visitId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.string().min(1),
  warehouseId: z.string().min(1),
});

async function createVisit(formData: FormData) {
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

    const parsed = visitSchema.safeParse({
      episodeId: formData.get("episodeId"),
      assignedUserId: formData.get("assignedUserId"),
      scheduledAt: formData.get("scheduledAt"),
      notes: formData.get("notes"),
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

    let assignedUserId: string | null = null;
    if (parsed.data.assignedUserId) {
      const assignedUser = await db.user.findFirst({
        where: {
          id: parsed.data.assignedUserId,
          tenantId: session.user.tenantId,
          isActive: true,
        },
      });
      if (!assignedUser) {
        throw new Error("USER_NOT_FOUND");
      }
      assignedUserId = assignedUser.id;
    }

    const visit = await db.visit.create({
      data: {
        tenantId: session.user.tenantId,
        patientId: episode.patientId,
        episodeId: episode.id,
        assignedUserId,
        createdById: session.user.id,
        scheduledAt: new Date(parsed.data.scheduledAt),
        notes: parsed.data.notes ?? null,
      },
    });

    await db.visitChecklistItem.createMany({
      data: defaultChecklistItems.map((item) => ({
        tenantId: session.user.tenantId,
        visitId: visit.id,
        key: item.key,
        label: item.label,
        isRequired: true,
      })),
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "visit.create",
      entityType: "Visit",
      entityId: visit.id,
    });
  });

  revalidatePath("/agenda");
}

async function checkInVisit(formData: FormData) {
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

    const visitId = String(formData.get("visitId") ?? "");
    if (!visitId) throw new Error("VALIDATION_ERROR");

    const visit = await db.visit.findFirst({
      where: { id: visitId, tenantId: session.user.tenantId },
    });

    if (!visit || visit.status !== "SCHEDULED") {
      throw new Error("INVALID_STATUS");
    }

    const updated = await db.visit.update({
      where: { id: visit.id },
      data: { status: VisitStatus.IN_PROGRESS, checkInAt: new Date() },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "visit.checkin",
      entityType: "Visit",
      entityId: updated.id,
    });
  });

  revalidatePath("/agenda");
}

async function completeVisit(formData: FormData) {
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

    const visitId = String(formData.get("visitId") ?? "");
    if (!visitId) throw new Error("VALIDATION_ERROR");

    const visit = await db.visit.findFirst({
      where: { id: visitId, tenantId: session.user.tenantId },
    });

    if (!visit || visit.status !== "IN_PROGRESS") {
      throw new Error("INVALID_STATUS");
    }

    const checklistIncomplete = await db.visitChecklistItem.count({
      where: { visitId: visit.id, isRequired: true, isCompleted: false },
    });
    if (checklistIncomplete > 0) {
      throw new Error("CHECKLIST_INCOMPLETE");
    }

    const notesCount = await db.clinicalNote.count({
      where: { visitId: visit.id },
    });
    if (notesCount === 0) {
      throw new Error("NOTE_REQUIRED");
    }

    const updated = await db.visit.update({
      where: { id: visit.id },
      data: { status: VisitStatus.COMPLETED, checkOutAt: new Date() },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "visit.complete",
      entityType: "Visit",
      entityId: updated.id,
    });
  });

  revalidatePath("/agenda");
}

async function cancelVisit(formData: FormData) {
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

    const visitId = String(formData.get("visitId") ?? "");
    if (!visitId) throw new Error("VALIDATION_ERROR");

    const visit = await db.visit.findFirst({
      where: { id: visitId, tenantId: session.user.tenantId },
    });

    if (!visit || visit.status === "COMPLETED") {
      throw new Error("INVALID_STATUS");
    }

    const updated = await db.visit.update({
      where: { id: visit.id },
      data: { status: VisitStatus.CANCELLED },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "visit.cancel",
      entityType: "Visit",
      entityId: updated.id,
    });
  });

  revalidatePath("/agenda");
}

async function toggleChecklistItem(formData: FormData) {
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

    const parsed = checklistSchema.safeParse({
      checklistId: formData.get("checklistId"),
      completed: formData.get("completed"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const checklistItem = await db.visitChecklistItem.findFirst({
      where: {
        id: parsed.data.checklistId,
        visit: { tenantId: session.user.tenantId },
      },
    });

    if (!checklistItem) {
      throw new Error("CHECKLIST_NOT_FOUND");
    }

    const completed = parsed.data.completed === "true";
    const updated = await db.visitChecklistItem.update({
      where: { id: checklistItem.id },
      data: {
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
        completedById: completed ? session.user.id : null,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "visit.checklist.update",
      entityType: "VisitChecklistItem",
      entityId: updated.id,
      meta: { completed },
    });
  });

  revalidatePath("/agenda");
}

async function addClinicalNote(formData: FormData) {
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

    const parsed = noteSchema.safeParse({
      visitId: formData.get("visitId"),
      summary: formData.get("summary"),
      subjective: formData.get("subjective"),
      objective: formData.get("objective"),
      assessment: formData.get("assessment"),
      plan: formData.get("plan"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const visit = await db.visit.findFirst({
      where: { id: parsed.data.visitId, tenantId: session.user.tenantId },
    });

    if (!visit) {
      throw new Error("VISIT_NOT_FOUND");
    }

    const structured = {
      subjective: parsed.data.subjective?.trim() || undefined,
      objective: parsed.data.objective?.trim() || undefined,
      assessment: parsed.data.assessment?.trim() || undefined,
      plan: parsed.data.plan?.trim() || undefined,
    };
    const hasStructured = Object.values(structured).some(Boolean);

    const note = await db.clinicalNote.create({
      data: {
        tenantId: session.user.tenantId,
        patientId: visit.patientId,
        episodeId: visit.episodeId,
        visitId: visit.id,
        authorId: session.user.id,
        content: parsed.data.summary.trim(),
        structured: hasStructured ? structured : null,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "clinicalNote.create",
      entityType: "ClinicalNote",
      entityId: note.id,
    });
  });

  revalidatePath("/agenda");
}

async function addVisitItem(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "CLINIC");
    await assertTenantModuleAccess(db, session.user.tenantId, "INVENTORY");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.PROFESIONAL,
    ]);

    const parsed = itemSchema.safeParse({
      visitId: formData.get("visitId"),
      productId: formData.get("productId"),
      quantity: formData.get("quantity"),
      warehouseId: formData.get("warehouseId"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const visit = await db.visit.findFirst({
      where: { id: parsed.data.visitId, tenantId: session.user.tenantId },
    });

    if (!visit) {
      throw new Error("VISIT_NOT_FOUND");
    }

    const warehouse = await db.warehouse.findFirst({
      where: { id: parsed.data.warehouseId, tenantId: session.user.tenantId },
    });
    if (!warehouse) {
      throw new Error("WAREHOUSE_NOT_FOUND");
    }

    const product = await db.product.findFirst({
      where: { id: parsed.data.productId, tenantId: session.user.tenantId },
    });
    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    const quantity = Number(parsed.data.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("INVALID_QUANTITY");
    }

    const item = await db.visitItem.create({
      data: {
        visitId: visit.id,
        productId: product.id,
        quantity,
        warehouseId: warehouse.id,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "visit.item.add",
      entityType: "VisitItem",
      entityId: item.id,
    });

    const movement = await db.stockMovement.create({
      data: {
        tenantId: session.user.tenantId,
        warehouseId: warehouse.id,
        productId: product.id,
        type: "OUT",
        quantity,
        referenceType: "VISIT_ITEM",
        referenceId: item.id,
        createdById: session.user.id,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "stock.movement.visit_item",
      entityType: "StockMovement",
      entityId: movement.id,
      meta: { quantity, productId: parsed.data.productId },
    });
  });

  revalidatePath("/agenda");
}

export default async function AgendaPage() {
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

    const inventoryAccess = await getTenantModuleAccess(
      db,
      tenantId,
      "INVENTORY",
    );

    const episodes = await db.episode.findMany({
      where: { tenantId, status: "ACTIVE" },
      include: { patient: true },
      orderBy: { startDate: "desc" },
    });
    const users = await db.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: "asc" },
    });
    const products = await db.product.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const warehouses = await db.warehouse.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const visits = await db.visit.findMany({
      where: { tenantId },
      include: {
        patient: true,
        assignedUser: true,
        clinicalNotes: { include: { author: true } },
        items: { include: { product: true, warehouse: true } },
        checklistItems: true,
        attachments: true,
      },
      orderBy: { scheduledAt: "desc" },
      take: 50,
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            Programacion de visitas, notas clinicas y consumos.
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
          {visits.map((visit) => {
            const requiredChecklist = visit.checklistItems.filter(
              (item) => item.isRequired && !item.isCompleted,
            );
            const hasNotes = visit.clinicalNotes.length > 0;
            const canComplete = requiredChecklist.length === 0 && hasNotes;
            const missing = [
              requiredChecklist.length > 0 ? "checklist" : null,
              !hasNotes ? "nota clinica" : null,
            ].filter(Boolean);

            return (
              <div key={visit.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">
                      {visit.patient.lastName}, {visit.patient.firstName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {visit.scheduledAt.toLocaleString("es-AR")} -{" "}
                      {visit.assignedUser?.name ?? "Sin asignar"} -{" "}
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
                        <Button
                          size="sm"
                          variant="secondary"
                          type="submit"
                          disabled={!canComplete}
                          title={
                            canComplete
                              ? "Completar visita"
                              : "Completa checklist y nota clinica"
                          }
                        >
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

                {visit.status === "IN_PROGRESS" && !canComplete ? (
                  <p className="mt-2 text-xs text-amber-600">
                    Para completar falta: {missing.join(", ")}.
                  </p>
                ) : null}

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <div className="text-sm font-medium">Checklist</div>
                    <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
                      {visit.checklistItems.map((item) => (
                        <li key={item.id} className="flex items-center gap-2">
                          <span
                            className={
                              item.isCompleted
                                ? "line-through text-muted-foreground"
                                : ""
                            }
                          >
                            {item.label}
                          </span>
                          <form action={toggleChecklistItem} className="ml-auto">
                            <input
                              type="hidden"
                              name="checklistId"
                              value={item.id}
                            />
                            <input
                              type="hidden"
                              name="completed"
                              value={item.isCompleted ? "false" : "true"}
                            />
                            <Button
                              size="sm"
                              variant={
                                item.isCompleted ? "outline" : "secondary"
                              }
                              type="submit"
                            >
                              {item.isCompleted ? "Desmarcar" : "Completar"}
                            </Button>
                          </form>
                        </li>
                      ))}
                      {visit.checklistItems.length === 0 ? (
                        <li>Sin checklist.</li>
                      ) : null}
                    </ul>
                  </div>

                  <form
                    action={addClinicalNote}
                    className="rounded-md border p-3"
                  >
                    <input type="hidden" name="visitId" value={visit.id} />
                    <Textarea
                      name="summary"
                      placeholder="Resumen clinico"
                      required
                    />
                    <Textarea
                      name="subjective"
                      placeholder="Subjetivo"
                      className="mt-2"
                    />
                    <Textarea
                      name="objective"
                      placeholder="Objetivo"
                      className="mt-2"
                    />
                    <Textarea
                      name="assessment"
                      placeholder="Evaluacion"
                      className="mt-2"
                    />
                    <Textarea name="plan" placeholder="Plan" className="mt-2" />
                    <Button size="sm" type="submit" className="mt-2">
                      Agregar nota
                    </Button>
                    <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                      {visit.clinicalNotes.map((note) => {
                        const structured = note.structured as
                          | {
                              subjective?: string;
                              objective?: string;
                              assessment?: string;
                              plan?: string;
                            }
                          | null;

                        return (
                          <div key={note.id} className="rounded border p-2">
                            <div className="font-medium">
                              {note.author.name ?? note.author.email}:{" "}
                              {note.content}
                            </div>
                            {structured?.subjective ? (
                              <div>Subjetivo: {structured.subjective}</div>
                            ) : null}
                            {structured?.objective ? (
                              <div>Objetivo: {structured.objective}</div>
                            ) : null}
                            {structured?.assessment ? (
                              <div>Evaluacion: {structured.assessment}</div>
                            ) : null}
                            {structured?.plan ? (
                              <div>Plan: {structured.plan}</div>
                            ) : null}
                          </div>
                        );
                      })}
                      {visit.clinicalNotes.length === 0 ? (
                        <div>Sin notas aun.</div>
                      ) : null}
                    </div>
                  </form>

                  <form action={addVisitItem} className="rounded-md border p-3">
                    <input type="hidden" name="visitId" value={visit.id} />
                    <select
                      name="warehouseId"
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      required
                      disabled={!inventoryAccess.allowed}
                    >
                      <option value="">Deposito...</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.id} value={warehouse.id}>
                          {warehouse.name}
                        </option>
                      ))}
                    </select>
                    <select
                      name="productId"
                      className="mt-2 h-9 rounded-md border bg-background px-2 text-sm"
                      required
                      disabled={!inventoryAccess.allowed}
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
                      disabled={!inventoryAccess.allowed}
                    />
                    <Button
                      size="sm"
                      type="submit"
                      className="mt-2"
                      disabled={!inventoryAccess.allowed}
                      title={
                        inventoryAccess.allowed
                          ? "Registrar consumo"
                          : inventoryAccess.reason ?? "Inventario bloqueado"
                      }
                    >
                      Registrar consumo
                    </Button>
                    {!inventoryAccess.allowed ? (
                      <p className="mt-2 text-xs text-amber-600">
                        Inventario bloqueado:{" "}
                        {inventoryAccess.reason ?? "sin acceso"}
                      </p>
                    ) : null}
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {visit.items.map((item) => (
                        <li key={item.id}>
                          {item.product.name} x {item.quantity}
                          {item.warehouse ? ` (${item.warehouse.name})` : ""}
                        </li>
                      ))}
                      {visit.items.length === 0 ? (
                        <li>Sin consumos aun.</li>
                      ) : null}
                    </ul>
                  </form>
                </div>

                <form
                  action={`/api/visits/${visit.id}/attachments`}
                  method="post"
                  encType="multipart/form-data"
                  className="mt-3 rounded-md border p-3"
                >
                  <input type="hidden" name="visitId" value={visit.id} />
                  <input
                    name="file"
                    type="file"
                    accept="image/*,application/pdf"
                    required
                  />
                  <Button size="sm" type="submit" className="mt-2">
                    Subir adjunto clinico
                  </Button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Adjuntos: {visit.attachments.length}
                  </p>
                  {visit.attachments.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {visit.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          {attachment.fileUrl ? (
                            <a
                              href={attachment.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              {attachment.fileName}
                            </a>
                          ) : (
                            attachment.fileName
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </form>
              </div>
            );
          })}
          {visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin visitas aun.</p>
          ) : null}
        </div>
      </div>
    );
  });
}
