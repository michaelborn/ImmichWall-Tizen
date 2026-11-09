#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startTestApp } from '../test/helpers/test-app.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'docs/screenshots');
const fixture = await startTestApp({ configured: false });
const browser = await chromium.launch({ headless: true });
await mkdir(output, { recursive: true });

function installTvStub(page, mockUrl, paired) {
    return page.addInitScript(({ url, isPaired }) => {
        window.ImmichWallRuntimeConfig = { pairingBaseUrl: '', defaultImmichServerUrl: '' };
        window.tizen = {
            keymanager: {
                getData() {
                    if (isPaired) return JSON.stringify({ serverUrl: url, apiKey: 'test-api-key' });
                    const error = new Error('not found');
                    error.name = 'NotFoundError';
                    throw error;
                },
                saveData(name, value, password, success) { if (success) success(); },
                removeData() { },
            },
        };
    }, { url: mockUrl, isPaired: paired });
}

try {
    const setupContext = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36',
    });
    const setupPage = await setupContext.newPage();
    await installTvStub(setupPage, fixture.upstreamUrl, false);
    await setupPage.goto(fixture.baseUrl);
    await setupPage.locator('#pair-view').waitFor({ state: 'visible' });
    await setupPage.locator('#pair-pin').waitFor({ state: 'visible' });
    await setupPage.screenshot({ path: resolve(output, 'setup-screen.png') });
    await setupContext.close();

    const settingsContext = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36',
    });
    const settingsPage = await settingsContext.newPage();
    await installTvStub(settingsPage, fixture.upstreamUrl, true);
    await settingsPage.goto(fixture.baseUrl);
    await settingsPage.locator('img[src^="blob:"]').first().waitFor({ state: 'attached' });

    await settingsPage.locator('.photo-layer.visible img').evaluate(async (image) => {
        const art = '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#263c56"/><stop offset="1" stop-color="#10131a"/></linearGradient><radialGradient id="r"><stop stop-color="#9cb6a3" stop-opacity=".52"/><stop offset="1" stop-color="#9cb6a3" stop-opacity="0"/></radialGradient></defs><rect width="1920" height="1080" fill="url(#g)"/><circle cx="620" cy="520" r="480" fill="url(#r)"/><circle cx="1430" cy="380" r="340" fill="url(#r)"/></svg>';
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(art);
        await image.decode();
    });

    await settingsPage.keyboard.press('s');
    await settingsPage.locator('#settings-panel.open').waitFor({ state: 'visible' });
    await settingsPage.locator('#source').selectOption('album');
    await settingsPage.waitForFunction(() => document.querySelectorAll('#album option').length > 1);
    const albumId = await settingsPage.locator('#album option').first().getAttribute('value');
    if (albumId) await settingsPage.locator('#album').selectOption(albumId);
    await settingsPage.locator('#interval').selectOption('300');
    await settingsPage.locator('.choice-card').filter({ hasText: 'Fit' }).click();
    await settingsPage.locator('#settings-server').evaluate((element) => { element.textContent = 'your Immich server'; });
    await settingsPage.screenshot({ path: resolve(output, 'settings-screen.png') });
    await settingsContext.close();
} finally {
    await browser.close();
    await fixture.close();
}

console.log('Wrote face-free screenshots to docs/screenshots/.');
