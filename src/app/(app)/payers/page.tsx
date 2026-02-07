import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { assertTenantModuleAccess, getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { withTenant } from "@/lib/rls";

const payerSchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
});

const planSchema = z.object({
  payerId: z.string().min(1),
  name: z.string().min(1),
});

const requirementSchema = z.object({
  payerId: z.string().min(1),
  name: z.string().min(1),
  isRequired: z.string().optional(),
});

async function createPayer(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "PAYERS");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.FACTURACION,
    ]);

    const parsed = payerSchema.safeParse({
      name: formData.get("name"),
      code: formData.get("code"),
    });
    if (!parsed.success) throw new Error("VALIDATION_ERROR");

    const payer = await db.payer.create({
      data: {
        tenantId: session.user.tenantId,
        name: parsed.data.name,
        code: parsed.data.code ?? null,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "payer.create",
      entityType: "Payer",
      entityId: payer.id,
    });
  });

  revalidatePath("/payers");
}

async function createPlan(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "PAYERS");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.FACTURACION,
    ]);

    const parsed = planSchema.safeParse({
      payerId: formData.get("payerId"),
      name: formData.get("name"),
    });
    if (!parsed.success) throw new Error("VALIDATION_ERROR");

    const payer = await db.payer.findFirst({
      where: { id: parsed.data.payerId, tenantId: session.user.tenantId },
    });
    if (!payer) {
      throw new Error("PAYER_NOT_FOUND");
    }

    const plan = await db.payerPlan.create({
      data: {
        tenantId: session.user.tenantId,
        payerId: payer.id,
        name: parsed.data.name,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "payer.plan.create",
      entityType: "PayerPlan",
      entityId: plan.id,
    });
  });

  revalidatePath("/payers");
}

async function createRequirement(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) throw new Error("UNAUTHORIZED");
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "PAYERS");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.FACTURACION,
    ]);

    const parsed = requirementSchema.safeParse({
      payerId: formData.get("payerId"),
      name: formData.get("name"),
      isRequired: formData.get("isRequired"),
    });
    if (!parsed.success) throw new Error("VALIDATION_ERROR");

    const payer = await db.payer.findFirst({
      where: { id: parsed.data.payerId, tenantId: session.user.tenantId },
    });
    if (!payer) {
      throw new Error("PAYER_NOT_FOUND");
    }

    const requirement = await db.payerRequirement.create({
      data: {
        tenantId: session.user.tenantId,
        payerId: payer.id,
        name: parsed.data.name,
        isRequired: parsed.data.isRequired === "on",
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "payer.requirement.create",
      entityType: "PayerRequirement",
      entityId: requirement.id,
    });
  });

  revalidatePath("/payers");
}

export default async function PayersPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "PAYERS");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const payers = await db.payer.findMany({
      where: { tenantId },
      include: {
        plans: true,
        requirements: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Obras sociales</h1>
        <p className="text-sm text-muted-foreground">
          Alta de pagadores, planes y requisitos.
        </p>
      </div>

      <form action={createPayer} className="grid gap-3 md:grid-cols-3">
        <Input name="name" placeholder="Nombre obra social" required />
        <Input name="code" placeholder="Código" />
        <Button type="submit" className="md:col-span-3">
          Crear obra social
        </Button>
      </form>

      <div className="space-y-4">
        {payers.map((payer) => (
          <div key={payer.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">{payer.name}</div>
              <span className="text-xs text-muted-foreground">
                {payer.code ?? "-"}
              </span>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium">Planes</div>
                <ul className="mt-2 text-xs text-muted-foreground">
                  {payer.plans.map((plan) => (
                    <li key={plan.id}>{plan.name}</li>
                  ))}
                  {payer.plans.length === 0 ? <li>Sin planes.</li> : null}
                </ul>
                <form action={createPlan} className="mt-2 flex gap-2">
                  <input type="hidden" name="payerId" value={payer.id} />
                  <Input name="name" placeholder="Nombre plan" required />
                  <Button size="sm" type="submit">
                    Agregar
                  </Button>
                </form>
              </div>

              <div className="rounded-md border p-3">
                <div className="text-sm font-medium">Requisitos</div>
                <ul className="mt-2 text-xs text-muted-foreground">
                  {payer.requirements.map((req) => (
                    <li key={req.id}>
                      {req.name} {req.isRequired ? "(obligatorio)" : ""}
                    </li>
                  ))}
                  {payer.requirements.length === 0 ? (
                    <li>Sin requisitos.</li>
                  ) : null}
                </ul>
                <form
                  action={createRequirement}
                  className="mt-2 flex flex-wrap gap-2"
                >
                  <input type="hidden" name="payerId" value={payer.id} />
                  <Input name="name" placeholder="Requisito" required />
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" name="isRequired" defaultChecked />
                    Obligatorio
                  </label>
                  <Button size="sm" type="submit">
                    Agregar
                  </Button>
                </form>
              </div>
            </div>
          </div>
        ))}
        {payers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin pagadores aún.</p>
        ) : null}
      </div>
    </div>
    );
  });
}
