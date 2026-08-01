/**
 * Settings persistence E2E (web).
 *
 * Requires a logged-in storage state via PLAYWRIGHT_STORAGE_STATE, or the
 * suite is skipped. Unit/API coverage lives in packages/shared + api-server
 * sanitizeSettings tests; full smoke is scripts/mobile-web-persistence-smoke.ps1.
 */
import { test, expect } from '@playwright/test';

const hasAuth = Boolean(process.env.PLAYWRIGHT_STORAGE_STATE);

test.describe('settings persistence', () => {
  test.skip(!hasAuth, 'Set PLAYWRIGHT_STORAGE_STATE to a logged-in storage file');

  test('study flashcard settings save and survive reload', async ({ page }) => {
    await page.goto('/');
    // Open settings (sidebar / menu entry varies by viewport)
    const settingsTrigger = page.getByRole('button', { name: /settings/i }).first();
    await settingsTrigger.click();
    await page.getByRole('tab', { name: /study/i }).click();

    const newCards = page.getByLabel(/new cards per day/i);
    await newCards.fill('25');
    await newCards.blur();

    // Wait for debounce + network
    await page.waitForTimeout(800);
    await page.reload();

    await settingsTrigger.click();
    await page.getByRole('tab', { name: /study/i }).click();
    await expect(page.getByLabel(/new cards per day/i)).toHaveValue('25');
  });
});
