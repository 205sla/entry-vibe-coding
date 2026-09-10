// @ts-check
const { defineConfig } = require('@playwright/test');
const baseURL = process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || '3000');

module.exports = defineConfig({
    testDir: './tests',
    testMatch: /e2e\.spec\.js$/,
    timeout: 60_000,
    use: {
        baseURL,
        trace: 'retain-on-failure',
    },
    reporter: [['list']],
    webServer: {
        command: 'node server.js',
        url: baseURL + '/editor.html',
        env: { PORT: new URL(baseURL).port || '80' },
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
