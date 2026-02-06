import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  unit: z.string().min(1),
  packSize: z.string().optional(),
});

async function createProduct(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "INVENTORY");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

    const parsed = productSchema.safeParse({
      name: formData.get("name"),
      sku: formData.get("sku"),
      unit: formData.get("unit"),
      packSize: formData.get("packSize"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const product = await db.product.create({
      data: {
        tenantId: session.user.tenantId,
        name: parsed.data.name,
        sku: parsed.data.sku || null,
        unit: parsed.data.unit,
        packSize: parsed.data.packSize
          ? Number(parsed.data.packSize)
          : null,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "product.create",
      entityType: "Product",
      entityId: product.id,
    });
  });

  revalidatePath("/inventory/products");
}

export default async function ProductsPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "INVENTORY");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const products = await db.product.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Productos</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo de insumos con unidad y presentación.
        </p>
      </div>

      <form action={createProduct} className="grid gap-3 md:grid-cols-4">
        <Input name="name" placeholder="Nombre" required />
        <Input name="sku" placeholder="SKU" />
        <Input name="unit" placeholder="Unidad (ej. unidad, caja)" required />
        <Input name="packSize" placeholder="Pack size (opcional)" />
        <Button type="submit" className="md:col-span-4">
          Crear producto
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Pack</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t">
                <td className="px-3 py-2">{product.name}</td>
                <td className="px-3 py-2">{product.sku ?? "-"}</td>
                <td className="px-3 py-2">{product.unit}</td>
                <td className="px-3 py-2">{product.packSize ?? "-"}</td>
              </tr>
            ))}
            {products.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-sm text-muted-foreground"
                  colSpan={4}
                >
                  Sin productos aún.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
    );
  });
}
