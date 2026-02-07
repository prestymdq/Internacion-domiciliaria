import { test, expect } from "@playwright/test";

test("billing flow end-to-end", async ({ page }) => {
  test.setTimeout(180000);

  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  test.skip(
    !email || !password,
    "E2E_USER_EMAIL y E2E_USER_PASSWORD no configurados",
  );

  const suffix = String(Date.now()).slice(-6);
  const warehouseName = `Dep${suffix}`;
  const productName = `Prod${suffix}`;
  const payerName = `Payer${suffix}`;
  const firstName = `Test${suffix}`;
  const lastName = `Factura${suffix}`;
  const dni = `8${suffix}`;
  const authNumber = `AUTH-${suffix}`;

  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(email!);
  await page.getByTestId("login-password").fill(password!);
  await page.getByTestId("login-submit").click();
  await expect(page.getByRole("link", { name: "Pacientes" })).toBeVisible();

  await page.goto("/inventory/warehouses");
  const warehouseForm = page
    .locator("form")
    .filter({ has: page.locator('input[name="name"]') })
    .first();
  await warehouseForm.locator('input[name="name"]').fill(warehouseName);
  await warehouseForm.locator('input[name="location"]').fill("E2E");
  await warehouseForm.locator('button[type="submit"]').click();
  await expect(page.getByRole("cell", { name: warehouseName })).toBeVisible();

  await page.goto("/inventory/products");
  const productForm = page
    .locator("form")
    .filter({ has: page.locator('input[name="name"]') })
    .first();
  await productForm.locator('input[name="name"]').fill(productName);
  await productForm.locator('input[name="sku"]').fill(`SKU-${suffix}`);
  await productForm.locator('input[name="unit"]').fill("unidad");
  await productForm.locator('input[name="packSize"]').fill("1");
  await productForm.locator('input[name="reorderPoint"]').fill("0");
  await productForm.locator('button[type="submit"]').click();
  await expect(page.getByRole("cell", { name: productName })).toBeVisible();

  await page.goto("/inventory/stock");
  const movementForm = page.locator("form", { hasText: "Movimiento" });
  await movementForm
    .locator('select[name="warehouseId"]')
    .selectOption({ label: warehouseName });
  await movementForm
    .locator('select[name="productId"]')
    .selectOption({ label: productName });
  await movementForm.locator('select[name="type"]').selectOption("IN");
  await movementForm.locator('input[name="quantity"]').fill("5");
  await movementForm
    .getByRole("button", { name: "Crear movimiento" })
    .click();

  await page.goto("/patients");
  const patientForm = page.locator("form", {
    has: page.getByRole("button", { name: "Crear paciente" }),
  });
  await patientForm.getByPlaceholder("Nombre", { exact: true }).fill(firstName);
  await patientForm
    .getByPlaceholder("Apellido", { exact: true })
    .fill(lastName);
  await patientForm.getByPlaceholder("DNI", { exact: true }).fill(dni);
  await patientForm.getByRole("button", { name: "Crear paciente" }).click();
  await expect(
    page.getByRole("cell", { name: `${lastName}, ${firstName}` }),
  ).toBeVisible();

  await page.goto("/episodes");
  await page
    .locator('select[name="patientId"]')
    .selectOption({ label: `${lastName}, ${firstName}` });
  await page.locator('input[name="startDate"]').fill(startDate);
  await page.getByRole("button", { name: "Crear episodio" }).click();
  await expect(
    page.getByRole("cell", { name: `${lastName}, ${firstName}` }),
  ).toBeVisible();

  await page.goto("/logistics/orders");
  const orderForm = page.locator("form", {
    has: page.getByRole("button", { name: "Crear orden" }),
  });
  await orderForm
    .locator('select[name="patientId"]')
    .selectOption({ label: `${lastName}, ${firstName}` });
  await orderForm.getByRole("button", { name: "Crear orden" }).click();

  const orderCard = page
    .locator("div.rounded-lg.border.p-4")
    .filter({ hasText: `Paciente: ${lastName}` })
    .first();
  await orderCard
    .locator('select[name="productId"]')
    .selectOption({ label: productName });
  await orderCard.locator('input[name="quantity"]').fill("1");
  await orderCard.getByRole("button", { name: "Agregar item" }).click();
  await orderCard.getByRole("button", { name: "Generar picklist" }).click();
  await expect(
    orderCard.getByRole("button", { name: "Picklist creada" }),
  ).toBeVisible();

  await page.goto("/logistics/picklists");
  const pickCard = page
    .locator("div.rounded-lg.border.p-4")
    .filter({ hasText: `Paciente: ${lastName}` })
    .first();
  await expect(pickCard).toBeVisible();
  const assignForm = pickCard.locator("form", { hasText: "Asignar" }).first();
  await expect(
    assignForm.locator('select[name="warehouseId"]'),
  ).toBeVisible();
  await assignForm
    .locator('select[name="warehouseId"]')
    .selectOption({ label: warehouseName });
  await assignForm.getByRole("button", { name: "Asignar" }).click();
  await pickCard.getByRole("button", { name: "Congelar y reservar" }).click();
  await pickCard.getByRole("button", { name: "Marcar packed" }).click();
  await pickCard.getByRole("button", { name: "Crear entrega" }).click();
  await expect(
    pickCard.getByRole("button", { name: "Entrega creada" }),
  ).toBeVisible();

  await page.goto("/logistics/deliveries");
  const deliveryCard = page
    .locator("div.rounded-lg.border.p-4")
    .filter({ hasText: `Paciente: ${lastName}` })
    .first();
  await expect(
    deliveryCard.getByRole("button", { name: "Subir evidencia" }),
  ).toBeVisible();
  const evidenceForm = deliveryCard
    .locator("form")
    .filter({ has: deliveryCard.getByRole("button", { name: "Subir evidencia" }) })
    .first();
  await evidenceForm.locator('input[type="file"]').setInputFiles({
    name: "evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("evidence"),
  });
  await evidenceForm.getByRole("button", { name: "Subir evidencia" }).click();
  await expect(deliveryCard.getByText("Evidencia: 1")).toBeVisible();
  const deliveryCardAfter = deliveryCard;
  await expect(
    deliveryCardAfter.getByPlaceholder("Retirante", { exact: true }),
  ).toBeVisible();
  await deliveryCardAfter
    .getByPlaceholder("Retirante", { exact: true })
    .fill("Tester");
  await deliveryCardAfter
    .getByPlaceholder("DNI retirante", { exact: true })
    .fill("12345678");
  await deliveryCardAfter
    .getByRole("button", { name: "Marcar en transito" })
    .click();
  await deliveryCardAfter
    .getByPlaceholder("Receptor", { exact: true })
    .fill("Receptor");
  await deliveryCardAfter
    .getByPlaceholder("DNI receptor", { exact: true })
    .fill("87654321");
  await deliveryCardAfter.getByPlaceholder("Vinculo", { exact: true }).fill(
    "Familiar",
  );
  await deliveryCardAfter
    .getByRole("button", { name: "Marcar entregado" })
    .click();
  await expect(
    deliveryCardAfter.getByText("Estado: DELIVERED"),
  ).toBeVisible();
  await deliveryCardAfter.getByRole("button", { name: "Cerrar entrega" }).click();

  await page.goto("/payers");
  await page.getByPlaceholder("Nombre obra social").fill(payerName);
  await page.getByRole("button", { name: "Crear obra social" }).click();
  await expect(page.getByText(payerName)).toBeVisible();

  await page.goto("/authorizations");
  await page
    .locator('select[name="payerId"]')
    .selectOption({ label: payerName });
  await page
    .locator('select[name="patientId"]')
    .selectOption({ label: `${lastName}, ${firstName}` });
  await page.locator('input[name="number"]').fill(authNumber);
  await page.locator('input[name="startDate"]').fill(startDate);
  await page.getByRole("button", { name: "Crear autorizacion" }).click();
  await expect(page.getByText(authNumber)).toBeVisible();

  await page.goto("/billing/rules");
  await page
    .locator('select[name="payerId"]')
    .selectOption({ label: payerName });
  await page
    .locator('select[name="productId"]')
    .selectOption({ label: productName });
  await page.locator('input[name="unitPrice"]').fill("100");
  await page.getByRole("button", { name: "Guardar regla" }).click();

  await page.goto("/billing/invoices");
  const invoiceCard = page
    .locator("div.rounded-lg.border.p-4")
    .filter({ hasText: `${lastName}, ${firstName}` })
    .first();
  await invoiceCard
    .locator('select[name="authorizationId"]')
    .selectOption({ label: new RegExp(authNumber) });
  await invoiceCard.getByRole("button", { name: "Crear factura" }).click();
  await expect(page.getByText(authNumber)).toBeVisible();

  await page.goto("/billing/payments");
  const invoiceSelect = page.locator('select[name="invoiceId"]');
  await invoiceSelect.selectOption({ index: 1 });
  await page.locator('input[name="amount"]').fill("100");
  await page.getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByText("Pagos")).toBeVisible();
});
