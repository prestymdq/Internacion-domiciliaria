import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { uploadEvidenceObject } from "@/lib/storage";
import { logAudit } from "@/lib/audit";
import { getTenantModuleAccess } from "@/lib/tenant-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const access = await getTenantModuleAccess(
    session.user.tenantId,
    "AUTHORIZATIONS",
  );
  if (!access.allowed) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const requirement = await prisma.authorizationRequirement.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    include: { authorization: true },
  });

  if (!requirement || requirement.authorization.tenantId !== session.user.tenantId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `tenants/${session.user.tenantId}/authorizations/${requirement.authorizationId}/${Date.now()}-${safeName}`;

  const uploaded = await uploadEvidenceObject({
    key,
    body: buffer,
    contentType: file.type || "application/octet-stream",
  });

  const updated = await prisma.authorizationRequirement.update({
    where: { id: requirement.id },
    data: {
      status: "SUBMITTED",
      fileKey: uploaded.key,
      fileUrl: uploaded.url ?? null,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      size: buffer.length,
      uploadedById: session.user.id,
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "authorization.requirement.upload",
    entityType: "AuthorizationRequirement",
    entityId: updated.id,
    meta: { fileName: updated.fileName },
  });

  return NextResponse.redirect(new URL("/authorizations", request.url));
}
