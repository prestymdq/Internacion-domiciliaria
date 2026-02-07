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
      Role.FACTURACION,
      Role.AUDITOR,
    ])
  ) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const lookup = await withTenant(session.user.tenantId, async (db) => {
    const access = await getTenantModuleAccess(
      db,
      session.user.tenantId,
      "AUTHORIZATIONS",
    );
    if (!access.allowed) {
      return { forbidden: true as const };
    }

    const requirement = await db.authorizationRequirement.findFirst({
      where: { id: params.id, tenantId: session.user.tenantId },
      include: { authorization: true, requirement: true },
    });

    return { requirement };
  });

  if (lookup.forbidden) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (
    !lookup.requirement ||
    lookup.requirement.authorization.tenantId !== session.user.tenantId
  ) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  }

  const requirement = lookup.requirement;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `tenants/${session.user.tenantId}/authorizations/${requirement.authorizationId}/${Date.now()}-${safeName}`;

  const uploaded = await uploadEvidenceObject({
    key,
    body: buffer,
    contentType: file.type || "application/octet-stream",
  });

  await withTenant(session.user.tenantId, async (db) => {
    const updated = await db.authorizationRequirement.update({
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

    const remainingRequired = await db.authorizationRequirement.count({
      where: {
        authorizationId: requirement.authorizationId,
        requirement: { isRequired: true },
        status: { notIn: ["SUBMITTED", "APPROVED"] },
      },
    });

    if (remainingRequired === 0) {
      const now = new Date();
      const authorization = await db.authorization.findUnique({
        where: { id: requirement.authorizationId },
      });

      if (authorization) {
        const expired =
          authorization.endDate && authorization.endDate < now;
        const canActivate =
          ["PENDING"].includes(authorization.status) && !expired;

        if (canActivate) {
          await db.authorization.update({
            where: { id: authorization.id },
            data: { status: "ACTIVE" },
          });
        } else if (expired && authorization.status !== "EXPIRED") {
          await db.authorization.update({
            where: { id: authorization.id },
            data: { status: "EXPIRED" },
          });
        }
      }
    }

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "authorization.requirement.upload",
      entityType: "AuthorizationRequirement",
      entityId: updated.id,
      meta: { fileName: updated.fileName },
    });
  });

  return NextResponse.redirect(new URL("/authorizations", request.url));
}
