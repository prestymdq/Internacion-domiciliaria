import { test, expect } from "@playwright/test";

test("create patient, episode and visit", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  test.skip(
    !email || !password,
    "E2E_USER_EMAIL y E2E_USER_PASSWORD no configurados",
  );

  const suffix = String(Date.now()).slice(-6);
  const firstName = `Test${suffix}`;
  const lastName = `E2E${suffix}`;
  const dni = `9${suffix}`;

  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const scheduledAt = new Date(today.getTime() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(email!);
  await page.getByTestId("login-password").fill(password!);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/patients");
  await page.getByPlaceholder("Nombre").fill(firstName);
  await page.getByPlaceholder("Apellido").fill(lastName);
  await page.getByPlaceholder("DNI").fill(dni);
  await page.getByRole("button", { name: "Crear paciente" }).click();
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

  await page.goto("/agenda");
  await page
    .locator('select[name="episodeId"]')
    .selectOption({ label: `${lastName}, ${firstName}` });
  await page.locator('input[name="scheduledAt"]').fill(scheduledAt);
  await page.getByRole("button", { name: "Programar visita" }).click();
  await expect(
    page.getByText(`${lastName}, ${firstName}`),
  ).toBeVisible();
});
