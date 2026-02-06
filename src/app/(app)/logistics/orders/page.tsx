import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";

const kitSchema = z.object({ name: z.string().min(1) });
const kitItemSchema = z.object({
  kitTemplateId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.string().min(1),
});

const orderSchema = z.object({
  patientId: z.string().min(1),
  notes: z.string().optional(),
});

const orderItemSchema = z.object({
  approvedOrderId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.string().min(1),
});

async function createKitTemplate(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

  const parsed = kitSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const template = await prisma.kitTemplate.create({
    data: {
      tenantId: session.user.tenantId,
      name: parsed.data.name,
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "kitTemplate.create",
    entityType: "KitTemplate",
    entityId: template.id,
  });

  revalidatePath("/logistics/orders");
}

async function addKitItem(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

  const parsed = kitItemSchema.safeParse({
    kitTemplateId: formData.get("kitTemplateId"),
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const item = await prisma.kitTemplateItem.create({
    data: {
      kitTemplateId: parsed.data.kitTemplateId,
      productId: parsed.data.productId,
      quantity: Number(parsed.data.quantity),
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "kitTemplate.item.add",
    entityType: "KitTemplateItem",
    entityId: item.id,
  });

  revalidatePath("/logistics/orders");
}

async function createOrder(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  assertRole(session.user.role, [
    Role.ADMIN_TENANT,
    Role.COORDINACION,
    Role.DEPOSITO,
  ]);

  const parsed = orderSchema.safeParse({
    patientId: formData.get("patientId"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const order = await prisma.approvedOrder.create({
    data: {
      tenantId: session.user.tenantId,
      patientId: parsed.data.patientId,
      notes: parsed.data.notes ?? null,
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "approvedOrder.create",
    entityType: "ApprovedOrder",
    entityId: order.id,
  });

  revalidatePath("/logistics/orders");
}

async function addOrderItem(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  assertRole(session.user.role, [
    Role.ADMIN_TENANT,
    Role.COORDINACION,
    Role.DEPOSITO,
  ]);

  const parsed = orderItemSchema.safeParse({
    approvedOrderId: formData.get("approvedOrderId"),
    productId: formData.get("productId"),
    quantity: formData.get("quantity"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const item = await prisma.approvedOrderItem.create({
    data: {
      approvedOrderId: parsed.data.approvedOrderId,
      productId: parsed.data.productId,
      quantity: Number(parsed.data.quantity),
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "approvedOrder.item.add",
    entityType: "ApprovedOrderItem",
    entityId: item.id,
  });

  revalidatePath("/logistics/orders");
}

async function generatePickList(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  assertRole(session.user.role, [
    Role.ADMIN_TENANT,
    Role.COORDINACION,
    Role.DEPOSITO,
  ]);

  const approvedOrderId = String(formData.get("approvedOrderId") ?? "");
  if (!approvedOrderId) {
    throw new Error("VALIDATION_ERROR");
  }

  const order = await prisma.approvedOrder.findFirst({
    where: { id: approvedOrderId, tenantId: session.user.tenantId },
    include: { items: true },
  });

  if (!order || order.items.length === 0) {
    throw new Error("ORDER_EMPTY");
  }

  const existing = await prisma.pickList.findFirst({
    where: { approvedOrderId: order.id, tenantId: session.user.tenantId },
  });

  if (existing) {
    revalidatePath("/logistics/orders");
    return;
  }

  const pickList = await prisma.pickList.create({
    data: {
      tenantId: session.user.tenantId,
      approvedOrderId: order.id,
      items: {
        create: order.items.map((item) => ({
          productId: item.productId,
          requestedQty: item.quantity,
          pickedQty: item.quantity,
        })),
      },
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "picklist.create",
    entityType: "PickList",
    entityId: pickList.id,
  });

  revalidatePath("/logistics/orders");
}

export default async function OrdersPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  const access = await getTenantModuleAccess(tenantId, "LOGISTICS");
  if (!access.allowed) {
    return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
  }

  const [products, patients, templates, orders] = await Promise.all([
    prisma.product.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
    prisma.patient.findMany({
      where: { tenantId },
      orderBy: { lastName: "asc" },
    }),
    prisma.kitTemplate.findMany({
      where: { tenantId },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.approvedOrder.findMany({
      where: { tenantId },
      include: {
        patient: true,
        items: { include: { product: true } },
        pickLists: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Órdenes y kits</h1>
        <p className="text-sm text-muted-foreground">
          Plantillas de kit y órdenes aprobadas para despacho.
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Kit templates</h2>
        <form action={createKitTemplate} className="flex flex-wrap gap-3">
          <Input name="name" placeholder="Nombre del kit" required />
          <Button type="submit">Crear kit</Button>
        </form>
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <div key={template.id} className="rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">{template.name}</div>
                <span className="text-xs text-muted-foreground">
                  {template.items.length} items
                </span>
              </div>
              <ul className="mt-2 text-sm text-muted-foreground">
                {template.items.map((item) => (
                  <li key={item.id}>
                    {item.product.name} x {item.quantity}
                  </li>
                ))}
                {template.items.length === 0 ? <li>Sin items.</li> : null}
              </ul>
              <form action={addKitItem} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="kitTemplateId" value={template.id} />
                <select
                  name="productId"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  required
                >
                  <option value="">Producto...</option>
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
                  required
                />
                <Button size="sm" type="submit">
                  Agregar item
                </Button>
              </form>
            </div>
          ))}
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin kits aún.</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Órdenes aprobadas</h2>
        <form action={createOrder} className="grid gap-3 md:grid-cols-4">
          <select
            name="patientId"
            className="h-10 rounded-md border bg-background px-3 text-sm"
            required
          >
            <option value="">Paciente...</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.lastName}, {patient.firstName}
              </option>
            ))}
          </select>
          <Textarea name="notes" placeholder="Notas" />
          <Button type="submit" className="md:col-span-4">
            Crear orden
          </Button>
        </form>

        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Paciente: {order.patient.lastName},{" "}
                    {order.patient.firstName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Items: {order.items.length}
                  </div>
                </div>
                <form action={generatePickList}>
                  <input
                    type="hidden"
                    name="approvedOrderId"
                    value={order.id}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    type="submit"
                    disabled={order.items.length === 0 || order.pickLists.length > 0}
                  >
                    {order.pickLists.length > 0
                      ? "Picklist creada"
                      : "Generar picklist"}
                  </Button>
                </form>
              </div>
              {order.notes ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {order.notes}
                </p>
              ) : null}
              <ul className="mt-2 text-sm text-muted-foreground">
                {order.items.map((item) => (
                  <li key={item.id}>
                    {item.product.name} x {item.quantity}
                  </li>
                ))}
                {order.items.length === 0 ? <li>Sin items.</li> : null}
              </ul>
              <form action={addOrderItem} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="approvedOrderId" value={order.id} />
                <select
                  name="productId"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  required
                >
                  <option value="">Producto...</option>
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
                  required
                />
                <Button size="sm" type="submit">
                  Agregar item
                </Button>
              </form>
            </div>
          ))}
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin órdenes aún.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
