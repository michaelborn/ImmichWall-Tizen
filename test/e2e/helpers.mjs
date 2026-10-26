import { expect } from '@playwright/test';

export const MOCK_URL = 'http://127.0.0.1:41781';

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

export async function waitForPhoto(page) {
    const image = page.locator('.photo-layer.visible img');
    await expect(image).toHaveAttribute('src', /^blob:/);
    return image.getAttribute('src');
}
