import {defineConfig} from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    fullyParallel: false,
    workers: 1,
    timeout: 90_000,
    expect: {timeout: 15_000, toHaveScreenshot: {maxDiffPixelRatio: 0.002, threshold: 0.15}},
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: [['list'], ['html', {open: 'never'}]],
    // Baselines are reviewed on Windows, the same platform as the visual CI job.
    snapshotPathTemplate: '{testDir}/snapshots/{platform}/{projectName}/{arg}{ext}',
    use: {
        baseURL: 'http://127.0.0.1:8782',
        browserName: 'chromium',
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']}
    },
    projects: [
        {name: 'desktop', use: {viewport: {width: 1440, height: 900}}},
        {name: 'narrow', use: {viewport: {width: 800, height: 700}}}
    ],
    webServer: {
        command: 'node tools/serve-demos.mjs --port 8782',
        url: 'http://127.0.0.1:8782/demos.html',
        reuseExistingServer: false,
        timeout: 30_000
    }
});
