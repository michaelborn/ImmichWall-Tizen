import { expect } from '@playwright/test';

export const MOCK_URL = 'http://127.0.0.1:41781';
export const APP_URL = 'http://127.0.0.1:41780';

export async function setMockState(changes) {
    const response = await fetch(MOCK_URL + '/__control', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
    });
    if (!response.ok) throw new Error(`Could not configure mock Immich (${response.status}).`);
    return response.json();
}

export async function mockState() {
    const response = await fetch(MOCK_URL + '/__state');
    if (!response.ok) throw new Error(`Could not read mock Immich state (${response.status}).`);
    return response.json();
}

export async function resetAppConnection() {
    const response = await fetch(APP_URL + '/api/disconnect', { method: 'POST' });
    if (!response.ok) throw new Error(`Could not reset test app connection (${response.status}).`);
}

export async function connectThroughSetup(page) {
    await page.goto('/');
    await expect(page.locator('#connect-form')).toBeVisible();
    await page.locator('#connect-server').fill(MOCK_URL);
    await page.locator('#connect-api-key').fill('playwright-test-key');
    await page.locator('#connect-submit').click();
    await waitForPhoto(page);
}

export async function waitForPhoto(page) {
    const image = page.locator('.photo-layer.visible img');
    await expect(image).toHaveAttribute('src', /^blob:/);
    return image.getAttribute('src');
}
