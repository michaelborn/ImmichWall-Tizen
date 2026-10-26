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

test('loads a photo and supports next, previous, pause, details, and fullscreen', async ({ page }) => {
    await page.goto('/');
    const firstPhoto = await waitForPhoto(page);
    await expect(page.locator('#position')).toHaveText('01');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#position')).toHaveText('02');
    const secondPhoto = await page.locator('.photo-layer.visible img').getAttribute('src');
    expect(secondPhoto).not.toBe(firstPhoto);

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#position')).toHaveText('01');
    await expect(page.locator('.photo-layer.visible img')).toHaveAttribute('src', firstPhoto);

    await page.keyboard.press('Space');
    await expect(page.locator('body')).toHaveClass(/is-paused/);
    await page.keyboard.press('Space');
    await expect(page.locator('body')).not.toHaveClass(/is-paused/);

    await page.keyboard.press('i');
    await expect(page.locator('#photo-info')).toHaveClass(/visible/);
    await expect(page.locator('#photo-name')).toContainText('test-photo-');

    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
});

test('auto-hides the control chrome and reveals it again on pointer activity', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await waitForPhoto(page);
    await page.clock.fastForward(4300);
    await expect(page.locator('body')).toHaveClass(/chrome-hidden/);

    await page.mouse.move(300, 250);
    await expect(page.locator('body')).not.toHaveClass(/chrome-hidden/);
});

test('rotates on the configured interval and does not poll while paused', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await waitForPhoto(page);
    await page.locator('#open-settings').click();
    await page.locator('#interval').selectOption('1');
    await page.locator('#save-settings').click();

    await page.clock.fastForward(60000);
    await expect(page.locator('#position')).toHaveText('02');

    await setMockState({ resetRequests: true });
    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(120000);
    expect((await mockState()).searchBodies).toHaveLength(0);

    await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(60000);
    await expect(page.locator('#position')).toHaveText('03');

    await setMockState({ resetRequests: true });
    await page.keyboard.press('Space');
    await page.clock.fastForward(120000);
    const state = await mockState();
    expect(state.searchBodies).toHaveLength(0);
    await expect(page.locator('body')).toHaveClass(/is-paused/);
});

test('keeps navigation history bounded during a long session', async ({ page }) => {
    await page.addInitScript(() => {
        window.__revokedObjectUrls = [];
        const original = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = function (url) {
            window.__revokedObjectUrls.push(url);
            return original(url);
        };
    });
    await page.goto('/');
    await waitForPhoto(page);
    for (let index = 0; index < 23; index++) {
        await page.locator('#next').click();
        await expect(page.locator('#position')).toHaveText(String(Math.min(index + 2, 20)).padStart(2, '0'));
    }
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#position')).toHaveText('19');
    const revokedCount = await page.evaluate(() => window.__revokedObjectUrls.length);
    expect(revokedCount).toBeGreaterThan(0);
});

test('remains functional when reduced motion is requested', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await waitForPhoto(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#position')).toHaveText('02');
});
