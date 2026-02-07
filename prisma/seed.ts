import { PrismaClient, Role, TenantStatus, PlanTier } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction(async (db) => {
    await db.$executeRaw`
      SELECT set_config('app.is_superadmin', 'true', true)
    `;
    await db.$executeRaw`
      SELECT set_config('app.tenant_id', '', true)
    `;

    const superadminEmail = process.env.SUPERADMIN_EMAIL ?? "superadmin@local";
    const superadminPassword =
      process.env.SUPERADMIN_PASSWORD ?? "ChangeMe123!";
    const superadminHash = await bcrypt.hash(superadminPassword, 10);

    await db.user.upsert({
      where: { email: superadminEmail },
      update: {
        role: Role.SUPERADMIN,
        passwordHash: superadminHash,
        isActive: true,
        tenantId: null,
        name: "Superadmin",
      },
      create: {
        email: superadminEmail,
        name: "Superadmin",
        role: Role.SUPERADMIN,
        passwordHash: superadminHash,
        isActive: true,
      },
    });

    const defaultTenantSlug = process.env.DEFAULT_TENANT_SLUG ?? "demo-salud";
    const tenant = await db.tenant.upsert({
      where: { slug: defaultTenantSlug },
      update: {},
      create: {
        name: "Demo Salud",
        slug: defaultTenantSlug,
        status: TenantStatus.TRIALING,
        plan: PlanTier.PRO,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    await db.tenantPolicy.upsert({
      where: { tenantId: tenant.id },
      update: {},
      create: {
        tenantId: tenant.id,
        pastDueBlockedModules: ["LOGISTICS", "INVENTORY"],
      },
    });

    await db.billingTemplate.upsert({
      where: {
        tenantId_name: {
          tenantId: tenant.id,
          name: "IOMA",
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "IOMA",
        config: {
          columns: [
            "invoiceNumber",
            "payerName",
            "patientName",
            "issuedAt",
            "totalAmount",
            "itemName",
            "itemQty",
            "itemUnitPrice",
            "itemSubtotal",
          ],
        },
      },
    });

    const tenantAdminEmail =
      process.env.DEFAULT_TENANT_ADMIN_EMAIL ?? "admin@demo.local";
    const tenantAdminPassword =
      process.env.DEFAULT_TENANT_ADMIN_PASSWORD ?? "ChangeMe123!";
    const tenantAdminHash = await bcrypt.hash(tenantAdminPassword, 10);

    await db.user.upsert({
      where: { email: tenantAdminEmail },
      update: {
        role: Role.ADMIN_TENANT,
        tenantId: tenant.id,
        passwordHash: tenantAdminHash,
        isActive: true,
        name: "Admin Demo",
      },
      create: {
        email: tenantAdminEmail,
        name: "Admin Demo",
        role: Role.ADMIN_TENANT,
        tenantId: tenant.id,
        passwordHash: tenantAdminHash,
        isActive: true,
      },
    });
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
