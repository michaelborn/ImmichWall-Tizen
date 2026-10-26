import { expect, test } from '@playwright/test';
import { mockState, setMockState, waitForPhoto } from './helpers.mjs';

test.beforeEach(async () => {
    await setMockState({
        searchMode: 'ok',
        thumbnailMode: 'ok',
        pingMode: 'ok',
        searchDelayMs: 0,
        thumbnailDelayMs: 0,
        resetRequests: true,
    });
});

test('selects favorites or an album and persists framing and interval preferences', async ({ page }) => {
    await page.goto('/');
    await waitForPhoto(page);
    await page.keyboard.press('s');
    await expect(page.locator('#settings-panel')).toHaveClass(/open/);

    await page.locator('#source').selectOption('favorites');
    await page.locator('#save-settings').click();
    await expect(page.locator('#settings-panel')).not.toHaveClass(/open/);
    await expect.poll(async () => {
        const state = await mockState();
        return state.searchBodies.some((body) => body.isFavorite === true);
    }).toBe(true);

    await page.keyboard.press('s');
    await page.locator('#source').selectOption('album');
    await expect(page.locator('#album-field')).toBeVisible();
    await expect(page.locator('#album option')).toHaveCount(2);
    const albumId = await page.locator('#album option').first().getAttribute('value');
    await page.locator('#album').selectOption(albumId);
    await page.locator('#interval').selectOption('1');
    await page.locator('.choice-card').filter({ hasText: 'Fit' }).click();
    await page.locator('#save-settings').click();

    await expect(page.locator('body')).toHaveClass(/fit-contain/);
    await expect.poll(async () => {
        const state = await mockState();
        return state.searchBodies.some((body) => body.albumIds?.includes(albumId));
    }).toBe(true);

    await page.reload();
    await waitForPhoto(page);
    await page.keyboard.press('s');
    await expect(page.locator('#source')).toHaveValue('album');
    await expect(page.locator('#album')).toHaveValue(albumId);
    await expect(page.locator('#interval')).toHaveValue('1');
    await expect(page.locator('input[name="fit"][value="contain"]')).toBeChecked();

    await page.locator('#reset-settings').click();
    await expect(page.locator('body')).not.toHaveClass(/fit-contain/);
    await expect(page.locator('#source')).toHaveValue('all');
    await expect(page.locator('#interval')).toHaveValue('5');
    await expect(page.locator('input[name="fit"][value="cover"]')).toBeChecked();
});

test('Escape closes the settings drawer', async ({ page }) => {
    await page.goto('/');
    await waitForPhoto(page);
    await page.keyboard.press('s');
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-panel')).not.toHaveClass(/open/);
});

test('album mode requires a selected album', async ({ page }) => {
    await page.goto('/');
    await waitForPhoto(page);
    await page.keyboard.press('s');
    await page.locator('#source').selectOption('album');
    await page.locator('#album').evaluate((select) => { select.selectedIndex = -1; });
    await page.locator('.settings-footer').scrollIntoViewIfNeeded();
    await page.locator('#save-settings').click();
    await expect(page.locator('#settings-panel')).toHaveClass(/open/);
    await expect(page.locator('#toast')).toContainText('Choose an album');
});

test('settings drawer fits a narrow desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await waitForPhoto(page);
    await page.keyboard.press('s');
    await expect(page.locator('#settings-panel')).toHaveClass(/open/);
    await expect(page.locator('#settings-panel')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#settings-panel')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#source')).toBeFocused();
    await page.locator('#save-settings').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#close-settings')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#save-settings')).toBeFocused();
    const metrics = await page.locator('#settings-panel').evaluate((panel) => ({
        width: panel.getBoundingClientRect().width,
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
    }));
    expect(metrics.width).toBeLessThanOrEqual(375);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
});
