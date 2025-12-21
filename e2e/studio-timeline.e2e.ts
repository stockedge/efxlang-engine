import { expect, test } from "@playwright/test";

test("studio: compile/run shows timeline glyphs and inspector JSON", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Run Studio" }).click();
  await expect(page.locator("#view-studio")).toHaveClass(/active/);

  const program =
    "print(handle { perform Foo(1) } with { Foo(x, k) => 42; });\n";
  await page.locator("#progModule").fill("progA");
  await page.locator("#progSrc").fill(program);
  await page.locator("#compileProg").click();
  await expect(page.locator("#timeline")).toContainText(
    "loaded module 'progA'",
  );

  await page.locator("#taskTid").fill("1");
  await page.locator("#taskModule").fill("progA");
  await page.locator("#createTask").click();
  await expect(page.locator("#timeline")).toContainText("created task tid=1");

  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("Paused", {
    timeout: 60_000,
  });
  await expect(page.locator("#console")).toContainText("42");

  await expect(
    page.locator("#timelineSvg [data-event-index]").last(),
  ).toBeVisible();
  await page.locator("#timelineSvg [data-event-index]").last().click();

  await page.locator('#right .tab[data-rtab=\"inspector\"]').click();
  await expect(page.locator("#inspector")).toContainText('\"type\"');
  await expect(page.locator("#reverseSelected")).toBeEnabled();
});
