import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { PlanTier, Role, TenantStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const tenantSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(3),
  plan: z.nativeEnum(PlanTier),
});

const adminSchema = z.object({
  tenantId: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
});

async function createTenant(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  assertRole(session.user.role, [Role.SUPERADMIN]);

  const parsed = tenantSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    plan: formData.get("plan"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      plan: parsed.data.plan,
      status: TenantStatus.TRIALING,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  await logAudit({
    actorId: session.user.id,
    action: "tenant.create",
    entityType: "Tenant",
    entityId: tenant.id,
    meta: { slug: tenant.slug },
  });

  revalidatePath("/onboarding");
}

async function createTenantAdmin(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error("UNAUTHORIZED");
  }
  assertRole(session.user.role, [Role.SUPERADMIN]);

  const parsed = adminSchema.safeParse({
    tenantId: formData.get("tenantId"),
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const user = await prisma.user.create({
    data: {
      tenantId: parsed.data.tenantId,
      email: parsed.data.email,
      name: parsed.data.name,
      role: Role.ADMIN_TENANT,
      passwordHash,
      isActive: true,
    },
  });

  await logAudit({
    actorId: session.user.id,
    tenantId: parsed.data.tenantId,
    action: "tenant.admin.create",
    entityType: "User",
    entityId: user.id,
  });

  revalidatePath("/onboarding");
}

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return <p>Sin sesión.</p>;
  }

  if (session.user.role !== "SUPERADMIN") {
    return (
      <p className="text-sm text-muted-foreground">
        Solo superadmin puede acceder.
      </p>
    );
  }

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Onboarding de tenants</h1>
        <p className="text-sm text-muted-foreground">
          Alta de empresa y usuarios administradores.
        </p>
      </div>

      <form action={createTenant} className="grid gap-3 md:grid-cols-4">
        <Input name="name" placeholder="Nombre empresa" required />
        <Input name="slug" placeholder="slug" required />
        <select
          name="plan"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          required
        >
          <option value="STARTER">STARTER</option>
          <option value="PRO">PRO</option>
          <option value="ENTERPRISE">ENTERPRISE</option>
        </select>
        <Button type="submit" className="md:col-span-4">
          Crear tenant
        </Button>
      </form>

      <form action={createTenantAdmin} className="grid gap-3 md:grid-cols-4">
        <select
          name="tenantId"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          required
        >
          <option value="">Tenant...</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
        <Input name="name" placeholder="Nombre admin" required />
        <Input name="email" placeholder="Email admin" required />
        <Input name="password" placeholder="Password" required />
        <Button type="submit" className="md:col-span-4">
          Crear admin tenant
        </Button>
      </form>
    </div>
  );
}
