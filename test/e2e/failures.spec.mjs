import { expect, test } from '@playwright/test';
import { setMockState, waitForPhoto } from './helpers.mjs';

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

test('keeps the displayed photo during Immich outage and resumes after recovery', async ({ page }) => {
    await page.goto('/');
    const firstPhoto = await waitForPhoto(page);

    await setMockState({ searchMode: 'error' });
    await page.locator('#next').click();
    await expect(page.locator('#warning')).toBeVisible();
    await expect(page.locator('.photo-layer.visible img')).toHaveAttribute('src', firstPhoto);

    await setMockState({ searchMode: 'ok' });
    await page.locator('#retry').click();
    await expect(page.locator('#warning')).toBeHidden();
    await expect.poll(() => page.locator('.photo-layer.visible img').getAttribute('src'))
        .not.toBe(firstPhoto);
});

test('keeps the existing image for an empty source and a corrupt thumbnail', async ({ page }) => {
    await page.goto('/');
    const firstPhoto = await waitForPhoto(page);

    await setMockState({ searchMode: 'empty' });
    await page.locator('#next').click();
    await expect(page.locator('#warning')).toBeVisible();
    await expect(page.locator('.photo-layer.visible img')).toHaveAttribute('src', firstPhoto);

    await setMockState({ searchMode: 'ok', thumbnailMode: 'corrupt' });
    await page.locator('#next').click();
    await expect(page.locator('#warning')).toBeVisible();
    await expect(page.locator('.photo-layer.visible img')).toHaveAttribute('src', firstPhoto);
});
