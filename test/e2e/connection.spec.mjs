import { expect, test } from '@playwright/test';
import { APP_URL, MOCK_URL, resetAppConnection, setMockState, waitForPhoto } from './helpers.mjs';

test.beforeEach(async () => {
    await resetAppConnection();
    await setMockState({
        searchMode: 'ok',
        thumbnailMode: 'ok',
        pingMode: 'ok',
        aboutMode: 'ok',
        searchDelayMs: 0,
        thumbnailDelayMs: 0,
        resetRequests: true,
    });
});

test('first launch shows a blank API-key screen and connects without saving the key', async ({ page }) => {
    const connectionBodies = [];
    page.on('request', (request) => {
        if (request.url().endsWith('/api/connect')) connectionBodies.push(request.postData());
    });

    await page.goto('/');
    await expect(page.locator('#connect-form')).toBeVisible();
    await expect(page.locator('#connect-server')).toHaveValue('https://immich.theborns.xyz');
    await expect(page.locator('#connect-api-key')).toHaveValue('');
    await expect(page.locator('#empty-message')).toContainText('Connect to your Immich server');

    await page.locator('#connect-server').fill(MOCK_URL);
    await page.locator('#connect-api-key').fill('playwright-test-key');
    await page.locator('#connect-submit').click();
    await waitForPhoto(page);

    expect(connectionBodies).toHaveLength(1);
    expect(JSON.parse(connectionBodies[0]).apiKey).toBe('playwright-test-key');
    await expect(page.locator('#connect-api-key')).toHaveValue('');
    const storedValues = await page.evaluate(() => Object.keys(localStorage).map((key) => localStorage.getItem(key)).join('\n'));
    expect(storedValues).not.toContain('playwright-test-key');

    const config = await fetch(APP_URL + '/api/config').then((response) => response.json());
    expect(config.configured).toBe(true);
    expect(JSON.stringify(config)).not.toContain('playwright-test-key');
});

test('a rejected key leaves the setup screen available for correction', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#connect-form')).toBeVisible();
    await page.locator('#connect-server').fill(MOCK_URL);
    await page.locator('#connect-api-key').fill('invalid-test-key');
    await page.locator('#connect-submit').click();

    await expect(page.locator('#connect-form')).toBeVisible();
    await expect(page.locator('#empty-message')).toContainText('rejected the API key');
    await expect(page.locator('#connect-api-key')).toHaveValue('invalid-test-key');
    const config = await fetch(APP_URL + '/api/config').then((response) => response.json());
    expect(config.configured).toBe(false);
});
