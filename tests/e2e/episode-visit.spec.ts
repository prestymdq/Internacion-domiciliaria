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
  await expect(page.getByRole("link", { name: "Pacientes" })).toBeVisible();

  await page.goto("/patients");
  const patientForm = page.locator("form", {
    has: page.getByRole("button", { name: "Crear paciente" }),
  });
  await patientForm.locator('input[name="firstName"]').fill(firstName);
  await patientForm.locator('input[name="lastName"]').fill(lastName);
  await patientForm.locator('input[name="dni"]').fill(dni);
  await patientForm.getByRole("button", { name: "Crear paciente" }).click();
  await expect(
    page.getByRole("cell", { name: `${lastName}, ${firstName}` }),
  ).toBeVisible();

  await page.goto("/episodes");
  const episodeForm = page.locator("form", {
    has: page.getByRole("button", { name: "Crear episodio" }),
  });
  await episodeForm
    .locator('select[name="patientId"]')
    .selectOption({ label: `${lastName}, ${firstName}` });
  await episodeForm.locator('input[name="startDate"]').fill(startDate);
  await episodeForm.getByRole("button", { name: "Crear episodio" }).click();
  await expect(
    page.getByRole("cell", { name: `${lastName}, ${firstName}` }),
  ).toBeVisible();

  await page.goto("/agenda");
  const visitForm = page.locator("form", {
    has: page.getByRole("button", { name: "Programar visita" }),
  });
  await visitForm
    .locator('select[name="episodeId"]')
    .selectOption({ label: `${lastName}, ${firstName}` });
  await visitForm.locator('input[name="scheduledAt"]').fill(scheduledAt);
  await visitForm.getByRole("button", { name: "Programar visita" }).click();
  const visitCard = page
    .locator("div.rounded-lg.border.p-4")
    .filter({ hasText: `${lastName}, ${firstName}` })
    .first();
  await expect(visitCard).toContainText(`${lastName}, ${firstName}`);
});
