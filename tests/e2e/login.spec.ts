import { test, expect } from "@playwright/test";

test("login and view dashboard", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  test.skip(
    !email || !password,
    "E2E_USER_EMAIL y E2E_USER_PASSWORD no configurados",
  );

  await page.goto("/login");
  await page.getByTestId("login-email").fill(email!);
  await page.getByTestId("login-password").fill(password!);
  await page.getByTestId("login-submit").click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(
    page.getByRole("heading", { name: "Dashboard" }),
  ).toBeVisible();
});
