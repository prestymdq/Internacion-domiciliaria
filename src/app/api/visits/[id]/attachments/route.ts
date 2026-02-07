import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { uploadEvidenceObject } from "@/lib/storage";
import { logAudit } from "@/lib/audit";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import { withTenant } from "@/lib/rls";
import { hasRole } from "@/lib/rbac";
import { Role } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (
    !hasRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.PROFESIONAL,
    ])
  ) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const accessResult = await withTenant(session.user.tenantId, async (db) => {
    const access = await getTenantModuleAccess(
      db,
      session.user.tenantId,
      "CLINIC",
    );
    if (!access.allowed) {
      return { forbidden: true as const };
    }

    const visit = await db.visit.findFirst({
      where: { id: params.id, tenantId: session.user.tenantId },
    });

    return { visit };
  });

  if (accessResult.forbidden) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (!accessResult.visit) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 400 });
  }

  const mimeType = file.type || "application/octet-stream";
  const isAllowed =
    mimeType.startsWith("image/") || mimeType === "application/pdf";
  if (!isAllowed) {
    return NextResponse.json({ error: "UNSUPPORTED_FILE_TYPE" }, { status: 400 });
  }

  const visit = accessResult.visit;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `tenants/${session.user.tenantId}/visits/${visit.id}/${Date.now()}-${safeName}`;

  const uploaded = await uploadEvidenceObject({
    key,
    body: buffer,
    contentType: mimeType,
  });

  await withTenant(session.user.tenantId, async (db) => {
    const created = await db.clinicalAttachment.create({
      data: {
        tenantId: session.user.tenantId,
        patientId: visit.patientId,
        episodeId: visit.episodeId,
        visitId: visit.id,
        fileKey: uploaded.key,
        fileUrl: uploaded.url ?? null,
        fileName: file.name,
        mimeType,
        size: buffer.length,
        uploadedById: session.user.id,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "clinical.attachment.upload",
      entityType: "ClinicalAttachment",
      entityId: created.id,
      meta: { fileName: created.fileName },
    });
  });

  return NextResponse.redirect(new URL("/agenda", request.url));
}
