// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    testMatch: /e2e\.spec\.js$/,
    timeout: 60_000,
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'retain-on-failure',
    },
    reporter: [['list']],
    webServer: {
        command: 'node server.js',
        url: 'http://localhost:3000/editor.html',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
