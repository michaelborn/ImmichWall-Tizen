import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    workers: 1,
    timeout: 20000,
    expect: { timeout: 5000 },
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:41780',
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'node e2e/start-app.mjs',
        url: 'http://127.0.0.1:41780/api/config',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
    outputDir: '../test-results',
});
