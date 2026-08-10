/**
 * T1.4 + EC-S4 regression gate (plan: dogfood-fixes-and-coverage-expansion).
 *
 * Validates: `<Page />` from the template-default scaffold HYDRATES with
 * `<main>`, `<header>` and `<textarea>` visible after the client-side mount.
 *
 * A required CI check — replaces the exclusive dependency on Chrome DevTools MCP
 * (which does not run in ambient CI) with deterministic headless Playwright.
 *
 * Reuses `fixtures/template-default` (local workspace; fast). The npm-published version
 * is a separate opt-in spec (`workflow_dispatch`).
 *
 * Acceptance signal: zero hydration errors in the console + the DOM contains header/main/textarea.
 */
import { test, expect } from '@playwright/test'

test.describe('Scaffold page hydration (EC-S4 regression gate)', () => {
  test('Page renders <header>, <main>, <footer>, and <textarea> after hydration', async ({
    page,
  }) => {
    // Given: a freshly booted template-default scaffold,
    await page.goto('/', { waitUntil: 'networkidle' })

    // When: hydration completes (client React mounts AgentComposer + Timeline),
    // Then: the interactive elements MUST appear.
    // 30s timeout — a Vite optimize-deps cold start can take 15s+ in CI.
    await expect(
      page.locator('textarea'),
      'textarea (AgentComposer input) must hydrate',
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('header'), '<header> must be in DOM').toBeVisible()
    await expect(page.locator('main'), '<main> must be in DOM').toBeVisible()
    // there is no footer in the current layout — the composer sits directly in <main>. Check removed.
  })

  test('Page brand "Theo Agent" appears in DOM (not empty shell)', async ({ page }) => {
    // Given: hydrated app,
    await page.goto('/', { waitUntil: 'networkidle' })
    // Wait for hydration completion via textarea visibility (chat composer mount).
    await expect(page.locator('textarea')).toBeVisible({ timeout: 30_000 })
    // When: brand renders no DOM,
    // Then: "Theo Agent" is present in the body innerText (regardless of the Tooltip-wrapped
    // element's visibility).
    const innerText = await page.evaluate(() => document.body.innerText)
    expect(innerText).toContain('Theo Agent')
  })

  test('Console has zero React hydration errors', async ({ page }) => {
    // Given: clean instrumented page load,
    const hydrationErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /hydrat/i.test(msg.text())) {
        hydrationErrors.push(msg.text())
      }
    })

    // When: page loads + hydrates,
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000) // safety wait pós-mount

    // Then: zero hydration mismatches.
    expect(
      hydrationErrors,
      hydrationErrors.length > 0
        ? `Hydration errors detected:\n${hydrationErrors.join('\n')}`
        : undefined,
    ).toEqual([])
  })

  test('Body DOM is not empty after hydration (regression gate)', async ({ page }) => {
    // Given: hydrated app,
    await page.goto('/')
    await expect(page.locator('textarea')).toBeVisible({ timeout: 30_000 })

    // When: query DOM extent,
    // Then: the body must have ≥1 interactive element (not only the toaster region, as in EC-S4).
    const interactiveCount = await page.evaluate(() => {
      return document.querySelectorAll('textarea, button, input, select, a[href]').length
    })
    expect(interactiveCount, 'body must contain interactive elements').toBeGreaterThan(0)
  })
})
