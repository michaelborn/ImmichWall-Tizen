import { expect, test } from '@playwright/test';
import { APP_URL, MOCK_URL, mockState, setMockState } from './helpers.mjs';

const REGULAR_ALBUM_ID = '00000000-0000-4000-8000-000000009001';
const LARGE_ALBUM_ID = '00000000-0000-4000-8000-000000009003';

test.beforeEach(async ({ context }) => {
    await setMockState({
        searchMode: 'ok',
        thumbnailMode: 'ok',
        searchDelayMs: 0,
        thumbnailDelayMs: 0,
        resetRequests: true,
    });
    await context.addInitScript((mockUrl) => {
        var connection = { serverUrl: mockUrl, apiKey: 'playwright-test-key' };
        window.tizen = {
            keymanager: {
                getData() { return JSON.stringify(connection); },
                saveData(name, raw, password, callback) {
                    connection = JSON.parse(raw);
                    if (callback) callback();
                },
                removeData() {
                    connection = null;
                },
            },
        };
    }, MOCK_URL);
});

test('TV mode talks to Immich directly and shares the desktop settings drawer', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator('body')).toHaveClass(/tv/);
    await expect(page.locator('#connect-form')).toBeHidden();
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    await expect(page.locator('#build-version')).toContainText('Build v');
    const state = await mockState();
    expect(state.requestLog.every((request) => request.hasApiKey)).toBe(true);

    await page.keyboard.press('s');
    await page.locator('#source').selectOption('favorites');
    await page.locator('#save-settings').click();
    await expect.poll(async () => {
        const current = await mockState();
        return current.randomBodies.some((body) => body.isFavorite === true);
    }).toBe(true);

    await page.keyboard.press('s');
    await page.locator('#source').selectOption('album');
    await expect(page.locator('#album option')).toHaveCount(2);
    await page.locator('#album').selectOption(REGULAR_ALBUM_ID);
    await page.locator('#interval').selectOption('10');
    await page.locator('.choice-card').filter({ hasText: 'Fit' }).click();
    await page.locator('#save-settings').click();
    await expect(page.locator('body')).toHaveClass(/fit-contain/);
    await expect.poll(async () => {
        const current = await mockState();
        return current.randomBodies.some((body) => body.albumIds?.[0] === REGULAR_ALBUM_ID);
    }).toBe(true);
    await expect(page.locator('#album option:checked')).toContainText('Weekend at the Lake');

    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlayPause', bubbles: true })));
    await expect(page.locator('body')).toHaveClass(/is-paused/);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaPlay', bubbles: true })));
    await expect(page.locator('body')).not.toHaveClass(/is-paused/);

    await page.reload();
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    await expect(page.locator('body')).toHaveClass(/fit-contain/);
    await page.keyboard.press('s');
    await expect(page.locator('#source')).toHaveValue('album');
    await expect(page.locator('#album')).toHaveValue(REGULAR_ALBUM_ID);
    await expect(page.locator('#interval')).toHaveValue('10');
    await expect(page.locator('input[name="fit"][value="contain"]')).toBeChecked();
});

test('TV album mode can target the large album too', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    await page.keyboard.press('s');
    await page.locator('#source').selectOption('album');
    await page.locator('#album').selectOption(LARGE_ALBUM_ID);
    await page.locator('#save-settings').click();
    await expect.poll(async () => {
        const current = await mockState();
        return current.randomBodies.some((body) => body.albumIds?.[0] === LARGE_ALBUM_ID);
    }).toBe(true);
});

test('the TV remote Up/Down opens the shared settings drawer, Back closes it', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#settings-panel')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-panel')).not.toHaveClass(/open/);
});

test('TV hides transport and fullscreen chrome but keeps info and settings', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    for (const id of ['previous', 'pause', 'next', 'fullscreen']) {
        await expect(page.locator(`#${id}`)).toBeHidden();
    }
    await expect(page.locator('#info')).toBeVisible();
    await expect(page.locator('#open-settings')).toBeVisible();
});

test('drawer controls show visible focus on TV, including the fit cards', async ({ page }) => {
    await page.goto(APP_URL);
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(1);
    await page.keyboard.press('s');
    await expect(page.locator('#settings-panel')).toHaveClass(/open/);

    await page.locator('#save-settings').focus();
    await expect(page.locator('#save-settings')).toBeFocused();
    const outline = await page.locator('#save-settings').evaluate((button) => {
        return getComputedStyle(button).outlineWidth + ' ' + getComputedStyle(button).outlineColor;
    });
    expect(outline).toContain('3px');

    await page.locator('input[name="fit"][value="cover"]').focus();
    await expect(page.locator('.choice-card').first()).toHaveClass(/focused/);

    await page.locator('#save-settings').focus();
    await expect(page.locator('.choice-card').first()).not.toHaveClass(/focused/);
});
