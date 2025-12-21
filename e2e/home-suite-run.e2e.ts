import { expect, test } from "@playwright/test";

test("home: Run All Samples (quick) completes with all PASS", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator("#runAllSamples")).toBeVisible();
  await expect(page.locator("#samplesStatus")).toContainText("Samples: ready");

  await page.locator("#runAllSamples").click();

  await expect(page.locator("#samplesStatus")).toContainText("Suite: done", {
    timeout: 120_000,
  });
  await expect(page.locator(".result.err")).toHaveCount(0);
  await expect(page.locator(".result.ok")).toHaveCount(8);
});
