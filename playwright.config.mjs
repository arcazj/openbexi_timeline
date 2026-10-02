import {defineConfig} from '@playwright/test';

const port=Number(process.env.TIMELINE_TEST_PORT || 8782);
if(!Number.isInteger(port) || port<1024 || port>65535)throw new Error('TIMELINE_TEST_PORT must be between 1024 and 65535.');
const baseURL=`http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './tests/browser',
    testIgnore: /(?:^|[\\/])performance\.spec\.mjs$/,
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
        baseURL,
        browserName: 'chromium',
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
            args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']}
    },
    projects: [
        {name: 'desktop', use: {viewport: {width: 1440, height: 900}}},
        {name: 'narrow', use: {viewport: {width: 800, height: 700}}}
    ],
    webServer: {
        command: `node tools/serve-demos.mjs --port ${port}`,
        url: `${baseURL}/demos.html`,
        reuseExistingServer: false,
        timeout: 30_000
    }
});
