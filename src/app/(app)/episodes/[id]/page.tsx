import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import AccessDenied from "@/components/app/access-denied";
import {
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import { withTenant } from "@/lib/rls";

type TimelineEvent = {
  at: Date;
  title: string;
  detail?: string;
};

export default async function EpisodeDetailPage({
  params,
}: {
  params: { id: string };
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

    const episode = await db.episode.findFirst({
      where: { id: params.id, tenantId },
      include: {
        patient: true,
        carePlan: true,
        workflowStage: true,
        visits: {
          include: {
            assignedUser: true,
            clinicalNotes: { include: { author: true } },
            items: { include: { product: true, warehouse: true } },
            checklistItems: true,
            attachments: true,
          },
          orderBy: { scheduledAt: "asc" },
        },
      },
    });

    if (!episode) {
      return <p className="text-sm text-muted-foreground">Episodio no encontrado.</p>;
    }

    const auditLogs = await db.auditLog.findMany({
      where: {
        tenantId,
        entityType: "Episode",
        entityId: episode.id,
      },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const stageNameById = new Map(
      (
        await db.episodeWorkflowStage.findMany({
          where: { tenantId },
        })
      ).map((stage) => [stage.id, stage.name]),
    );

    const timeline: TimelineEvent[] = [
      {
        at: episode.startDate,
        title: "Ingreso del episodio",
        detail: episode.diagnosis ?? undefined,
      },
    ];

    if (episode.carePlan) {
      timeline.push({
        at: episode.carePlan.updatedAt,
        title: "Plan de cuidado actualizado",
        detail: episode.carePlan.summary ?? undefined,
      });
    }

    auditLogs.forEach((log) => {
      if (log.action === "episode.workflow_stage.update") {
        const meta = (log.meta ?? {}) as { workflowStageId?: string };
        const stageName = meta.workflowStageId
          ? stageNameById.get(meta.workflowStageId)
          : "Sin estado";
        timeline.push({
          at: log.createdAt,
          title: "Workflow actualizado",
          detail: stageName,
        });
      }
      if (log.action === "episode.discharge") {
        timeline.push({
          at: log.createdAt,
          title: "Egreso del episodio",
        });
      }
    });

    episode.visits.forEach((visit) => {
      timeline.push({
        at: visit.scheduledAt,
        title: "Visita programada",
        detail: visit.assignedUser?.name ?? visit.assignedUser?.email ?? undefined,
      });
      if (visit.checkInAt) {
        timeline.push({
          at: visit.checkInAt,
          title: "Check-in de visita",
        });
      }
      if (visit.checkOutAt) {
        timeline.push({
          at: visit.checkOutAt,
          title: "Visita completada",
        });
      }
      visit.clinicalNotes.forEach((note) => {
        timeline.push({
          at: note.createdAt,
          title: "Nota clinica",
          detail: note.content,
        });
      });
      visit.items.forEach((item) => {
        timeline.push({
          at: item.createdAt,
          title: "Consumo clinico",
          detail: `${item.product.name} x ${item.quantity}`,
        });
      });
      visit.attachments.forEach((attachment) => {
        timeline.push({
          at: attachment.createdAt,
          title: "Adjunto clinico",
          detail: attachment.fileName,
        });
      });
    });

    timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

    const careObjectives = Array.isArray(episode.carePlan?.objectives)
      ? (episode.carePlan?.objectives as string[])
      : [];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Episodio
            </p>
            <h1 className="text-2xl font-semibold">
              {episode.patient.lastName}, {episode.patient.firstName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Estado: {episode.status}{" "}
              {episode.workflowStage ? `- ${episode.workflowStage.name}` : ""}
            </p>
          </div>
          <Link
            href="/episodes"
            className="rounded-md border px-3 py-2 text-sm"
          >
            Volver a episodios
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">Resumen</h2>
            <div className="mt-2 text-sm text-muted-foreground">
              <div>Inicio: {episode.startDate.toLocaleDateString("es-AR")}</div>
              <div>
                Fin:{" "}
                {episode.endDate
                  ? episode.endDate.toLocaleDateString("es-AR")
                  : "-"}
              </div>
              <div>Diagnostico: {episode.diagnosis ?? "Sin diagnostico"}</div>
              <div>Notas: {episode.notes ?? "Sin notas"}</div>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">Plan de cuidado</h2>
            {episode.carePlan ? (
              <div className="mt-2 text-sm text-muted-foreground">
                <div>Resumen: {episode.carePlan.summary ?? "Sin resumen"}</div>
                <div>
                  Frecuencia: {episode.carePlan.frequency ?? "Sin definir"}
                </div>
                <div className="mt-2 text-xs font-medium text-foreground">
                  Objetivos
                </div>
                {careObjectives.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-xs">
                    {careObjectives.map((objective, index) => (
                      <li key={`${episode.id}-obj-${index}`}>- {objective}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Sin objetivos cargados.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Sin plan de cuidado.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Timeline clinica</h2>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            {timeline.map((event, index) => (
              <div key={`${event.at.getTime()}-${index}`} className="flex gap-3">
                <div className="w-40 text-xs">
                  {event.at.toLocaleString("es-AR")}
                </div>
                <div>
                  <div className="font-medium text-foreground">
                    {event.title}
                  </div>
                  {event.detail ? (
                    <div className="text-xs">{event.detail}</div>
                  ) : null}
                </div>
              </div>
            ))}
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin eventos registrados.
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Visitas</h2>
          {episode.visits.map((visit) => {
            const requiredChecklist = visit.checklistItems.filter(
              (item) => item.isRequired && !item.isCompleted,
            );
            return (
              <div key={visit.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">
                      {visit.scheduledAt.toLocaleString("es-AR")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Estado: {visit.status} -{" "}
                      {visit.assignedUser?.name ??
                        visit.assignedUser?.email ??
                        "Sin asignar"}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Checklist pendiente: {requiredChecklist.length}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <div className="text-sm font-medium">Notas clinicas</div>
                    {visit.clinicalNotes.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Sin notas.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
                        {visit.clinicalNotes.map((note) => (
                          <li key={note.id}>
                            <div className="font-medium text-foreground">
                              {note.author.name ?? note.author.email}
                            </div>
                            <div>{note.content}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-sm font-medium">Consumibles</div>
                    {visit.items.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Sin consumos.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {visit.items.map((item) => (
                          <li key={item.id}>
                            {item.product.name} x {item.quantity}
                            {item.warehouse
                              ? ` (${item.warehouse.name})`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-sm font-medium">Adjuntos</div>
                    {visit.attachments.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Sin adjuntos.
                      </p>
                    ) : (
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
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {episode.visits.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin visitas.</p>
          ) : null}
        </div>
      </div>
    );
  });
}
