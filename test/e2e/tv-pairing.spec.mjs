import { expect, test } from '@playwright/test';
import { APP_URL } from './helpers.mjs';

let sessionCount = 0;

test.beforeEach(async ({ context }) => {
    sessionCount = 0;
    await context.addInitScript(() => {
        window.tizen = {
            keymanager: {
                getData() {
                    const error = new Error('not found');
                    error.name = 'NotFoundError';
                    throw error;
                },
                saveData(name, raw, password, callback) {
                    if (callback) callback();
                },
                removeData() { },
            },
        };
    });
    await context.route(/\/api\/pairing\/sessions(\/.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === 'POST') {
            sessionCount += 1;
            return route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({
                    sessionId: 'tv-test-session-' + sessionCount,
                    pin: sessionCount === 1 ? '11111' : '22222',
                    expiresAt: Date.now() + 300000,
                }),
            });
        }
        if (url.endsWith('/sessions/tv-test-session-1')) {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ state: 'expired' }),
            });
        }
        return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ state: 'waiting', expiresAt: Date.now() + 300000 }),
        });
    });
});

test('the TV rotates the PIN automatically with no settings chrome while pairing', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator('#pair-view')).toBeVisible();
    await expect(page.locator('#pair-pin')).toHaveText(/^(11111|22222)$/);
    await expect(page.locator('body')).toHaveClass(/pairing/);
    await expect(page.locator('#controls')).toBeHidden();
    await expect(page.locator('#new-pairing')).toHaveCount(0);

    await expect(page.locator('#pair-pin')).toHaveText('22222', { timeout: 10000 });
    await expect(page.locator('#pair-view')).toBeVisible();
    await expect(page.locator('#pair-expiry')).toContainText('refreshes automatically');
});
