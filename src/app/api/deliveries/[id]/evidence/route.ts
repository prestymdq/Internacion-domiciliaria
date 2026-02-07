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
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (
      !hasRole(session.user.role, [
        Role.ADMIN_TENANT,
        Role.COORDINACION,
        Role.LOGISTICA,
        Role.DEPOSITO,
      ])
    ) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const accessResult = await withTenant(session.user.tenantId, async (db) => {
      const access = await getTenantModuleAccess(
        db,
        session.user.tenantId,
        "LOGISTICS",
      );
      if (!access.allowed) {
        return { forbidden: true as const };
      }

      const delivery = await db.delivery.findFirst({
        where: { id: params.id, tenantId: session.user.tenantId },
      });

      return { delivery };
    });

    if (accessResult.forbidden) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    if (!accessResult.delivery) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof (file as Blob).arrayBuffer !== "function") {
      return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
    }

    const delivery = accessResult.delivery;

    const fileName =
      typeof (file as { name?: string }).name === "string"
        ? (file as { name: string }).name
        : "evidence.bin";
    const mimeType =
      (file as { type?: string }).type || "application/octet-stream";

    const arrayBuffer = await (file as Blob).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `tenants/${session.user.tenantId}/deliveries/${delivery.deliveryNumber}/${Date.now()}-${safeName}`;

    let uploaded: { key: string; url: string | undefined };
    try {
      uploaded = await uploadEvidenceObject({
        key,
        body: buffer,
        contentType: mimeType,
      });
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw error;
      }
      uploaded = { key, url: undefined };
    }

    await withTenant(session.user.tenantId, async (db) => {
      const created = await db.deliveryEvidence.create({
        data: {
        deliveryId: delivery.id,
        fileKey: uploaded.key,
        fileUrl: uploaded.url ?? null,
        fileName,
        mimeType,
        size: buffer.length,
        uploadedById: session.user.id,
      },
      });

      await logAudit(db, {
        tenantId: session.user.tenantId,
        actorId: session.user.id,
        action: "delivery.evidence.upload",
        entityType: "DeliveryEvidence",
        entityId: created.id,
        meta: { fileName: created.fileName },
      });
    });

    return NextResponse.redirect(
      new URL("/logistics/deliveries", request.url),
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json(
        {
          error: "EVIDENCE_UPLOAD_FAILED",
          detail:
            error instanceof Error ? error.message : String(error ?? "unknown"),
        },
        { status: 500 },
      );
    }
    throw error;
  }
}
