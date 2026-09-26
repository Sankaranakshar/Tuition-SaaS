import { expect, type Page, type Browser, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { TestUser } from "./admin";

/**
 * Signs in through the real login page. The page opens on the Phone/OTP tab,
 * which cannot work (no SMS provider is configured anywhere), so every login
 * has to switch to the Email tab first. That default is a known bug slated
 * for EXECUTION_PLAN.md Step 34 and is deliberately not fixed here.
 */
export async function login(page: Page, user: Pick<TestUser, "email" | "password">): Promise<void> {
  if (!page.url().includes("/login")) await page.goto("/login");
  await page.getByRole("button", { name: "Email", exact: true }).click();
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** A fresh, isolated browser session (its own cookies and storage) signed in as `user`. */
export async function sessionFor(browser: Browser, user: TestUser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, user);
  return { context, page };
}

/**
 * Calls the app's own API from inside the signed-in page, with the same token
 * and X-Organization-Id header src/lib/api.ts sends. Used only where the app
 * has no UI for an action yet (attendance reversal); each call site says so.
 */
export async function callApiAsPage<T = unknown>(
  page: Page,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ({ path, body }) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      const token = key ? JSON.parse(localStorage.getItem(key) || "{}").access_token : null;
      if (!token) throw new Error("no Supabase session in this page");
      const org = localStorage.getItem("activeOrganizationId");
      const resp = await fetch(`/api/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(org ? { "X-Organization-Id": org } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: resp.status, body: await resp.json().catch(() => ({})) };
    },
    { path, body },
  ) as Promise<{ status: number; body: T }>;
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Automated axe pass (WCAG 2.1 A/AA) over the page as it currently renders.
 * Fails on any violation, listing each rule with the offending selectors so a
 * CI failure is readable without downloading the trace.
 */
export async function expectAccessible(page: Page, surface: string): Promise<void> {
  // Let lazy chunks, data and entrance motion settle before auditing.
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join("\n    ")}`,
  );
  expect.soft(summary, `axe violations on ${surface}`).toEqual([]);
}

/** Today's date in the org's zone (Asia/Kolkata), as YYYY-MM-DD. */
export function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}
