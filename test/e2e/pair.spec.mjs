import { expect, test } from '@playwright/test';
import { APP_URL, MOCK_URL } from './helpers.mjs';

async function createPairingSession() {
    return fetch(APP_URL + '/api/pairing/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    }).then((response) => response.json());
}

test('pair page walks a user from PIN verification to a completed pairing', async ({ page }) => {
    const session = await createPairingSession();

    await page.goto('/pair');
    await expect(page.locator('#step-pin')).toBeVisible();
    await expect(page.locator('#step-details')).toBeHidden();

    await page.locator('#pin').fill('34a5');
    await expect(page.locator('#pin')).toHaveValue('345');

    await page.locator('#verify-button').click();
    await expect(page.locator('#status')).toHaveClass(/error/);
    await expect(page.locator('#step-pin')).toBeVisible();

    await page.locator('#pin').fill(session.pin);
    await page.locator('#verify-button').click();
    await expect(page.locator('#step-details')).toBeVisible();
    await expect(page.locator('#step-pin')).toBeHidden();

    await page.locator('#server-url').fill(MOCK_URL);
    await page.locator('#api-key').fill('playwright-test-key');
    await page.locator('#submit-button').click();
    await expect(page.locator('#status')).toContainText('Waiting for the TV');

    await page.reload();
    await expect(page.locator('#step-details')).toBeVisible();
    await expect(page.locator('#step-pin')).toBeHidden();
    await expect(page.locator('#server-url')).toBeEditable();
    await expect(page.locator('#api-key')).toBeEditable();

    const claimed = await fetch(APP_URL + `/api/pairing/sessions/${session.sessionId}`).then((response) => response.json());
    await fetch(APP_URL + '/api/pairing/session-error', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, revision: claimed.revision, message: 'Immich rejected the API key' }),
    });
    await expect(page.locator('#status')).toHaveClass(/error/);
    await expect(page.locator('#status')).toContainText('Immich rejected the API key');

    await page.locator('#api-key').fill('fixed-playwright-key');
    await page.locator('#submit-button').click();
    await expect(page.locator('#status')).toContainText('Connection updated');

    await fetch(APP_URL + '/api/pairing/acknowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, revision: claimed.revision + 1 }),
    });
    await expect(page.locator('#status')).toContainText('Pairing complete');
    await expect(page.locator('#step-details')).toBeHidden();
    await expect(page.locator('#start-over')).toBeHidden();
});

test('start over clears an in-progress handoff and returns to a writable PIN screen', async ({ page }) => {
    const session = await createPairingSession();
    await page.goto('/pair');
    await page.locator('#pin').fill(session.pin);
    await page.locator('#verify-button').click();
    await expect(page.locator('#step-details')).toBeVisible();
    await page.locator('#server-url').fill(MOCK_URL);
    await page.locator('#api-key').fill('playwright-test-key');
    await page.locator('#submit-button').click();
    await expect(page.locator('#status')).toContainText('Waiting for the TV');

    await page.locator('#start-over').click();
    await expect(page.locator('#step-pin')).toBeVisible();
    await expect(page.locator('#pin')).toBeEditable();
    await expect(page.locator('#pin')).toHaveValue('');
    await expect(page.locator('#api-key')).toHaveValue('');
});
