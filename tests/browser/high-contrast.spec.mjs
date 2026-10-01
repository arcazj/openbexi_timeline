import {test, expect} from '@playwright/test';

async function ready(page) {
    await expect.poll(() => page.evaluate(async () => {
        const timeline = await (await import('/src/openbexi_demo.js')).demoReady;
        return Boolean(timeline.ob_results.pending || timeline.ob_results.fetching || timeline.ob_results.explorer.seeking);
    })).toBe(false);
}

function contrastRatio(first, second) {
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
        .map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
        .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

async function enableContrast(page) {
    await page.clock.setFixedTime(new Date('2026-09-12T12:30:00Z'));
    await page.goto('/demos.html?demo=default-dataset');
    await ready(page);
    await page.getByAltText('Settings', {exact: true}).click();
    await page.getByRole('radio', {name: 'High contrast', exact: true}).check();
    await expect(page.locator('html')).toHaveAttribute('data-ob-theme', 'contrast');
    await page.getByRole('button', {name: 'Close settings', exact: true}).click();
    await ready(page);
    await page.mouse.move(0, 0);
}

test('High contrast gives both menu bars distinct controls and strong separators at every width', async ({page}, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await enableContrast(page);
    const widths = info.project.name === 'desktop' ? [1920, 1440] : [800, 420];
    for (const width of widths) {
        await page.setViewportSize({width, height: 900});
        await ready(page);
        const header = page.locator('.ob_results_header');
        const background = await header.evaluate(node => getComputedStyle(node).backgroundColor);
        expect(background).toBe('rgb(17, 17, 17)');
        for (const bar of ['.ob_primary_toolbar', '.ob_activity_toolbar']) {
            const styles = await page.locator(bar).evaluate(node => {
                const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
                const controls = [...node.querySelectorAll('button, img[role=button], label')]
                    .filter(element => visible(element) && !element.matches('button img'));
                const separators = [...node.querySelectorAll('.ob_toolbar_separator')].filter(visible);
                const style = element => {
                    const css = getComputedStyle(element);
                    return {name: element.textContent || element.getAttribute('alt') || element.getAttribute('aria-label'),
                        color: css.color, background: css.backgroundColor, border: css.borderTopColor,
                        borderWidth: parseFloat(css.borderTopWidth), width: element.getBoundingClientRect().width, opacity: css.opacity};
                };
                return {controls: controls.map(style), separators: separators.map(style)};
            });
            expect(styles.controls.length).toBeGreaterThan(0);
            expect(styles.separators.length).toBeGreaterThan(0);
            for (const control of styles.controls) {
                expect(contrastRatio(control.color, control.background), control.name).toBeGreaterThanOrEqual(4.5);
                expect(contrastRatio(control.background, background), control.name).toBeGreaterThanOrEqual(3);
                expect(control.borderWidth, control.name).toBeGreaterThanOrEqual(2);
                expect(control.opacity, control.name).toBe('1');
            }
            for (const separator of styles.separators) {
                expect(separator.width).toBeGreaterThanOrEqual(3);
                expect(contrastRatio(separator.background, background)).toBeGreaterThanOrEqual(3);
            }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({path: info.outputPath(`high-contrast-${width}.png`)});
    }
    expect(errors).toEqual([]);
});

test('High contrast preserves hover, focus, pressed, checked and disabled states', async ({page}) => {
    await enableContrast(page);
    const settings = page.getByAltText('Settings', {exact: true});
    await expect(settings).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await settings.hover();
    await expect(settings).toHaveCSS('background-color', 'rgb(197, 232, 255)');
    await page.mouse.move(0, 0);

    const table = page.locator('.ob_view_modes button[aria-pressed=false]').first();
    await page.keyboard.press('Tab');
    await table.focus();
    await expect(table).toHaveCSS('outline-width', '3px');
    const outline = await table.evaluate(node => getComputedStyle(node).outlineColor);
    expect(contrastRatio(outline, 'rgb(17, 17, 17)')).toBeGreaterThanOrEqual(3);
    await table.hover();
    await page.mouse.down();
    await expect(table).toHaveCSS('background-color', 'rgb(255, 231, 74)');
    await page.mouse.up();
    await ready(page);
    const selected = page.locator('.ob_view_modes button[aria-pressed=true]');
    await expect(selected).toHaveCSS('background-color', 'rgb(255, 231, 74)');
    await expect(selected.locator('svg')).toHaveCSS('stroke', 'rgb(0, 0, 0)');

    const auto = page.getByLabel('Auto scale', {exact: true});
    await auto.check();
    await ready(page);
    await expect(auto.locator('..')).toHaveCSS('background-color', 'rgb(255, 231, 74)');
    await auto.uncheck();
    await ready(page);
    await page.mouse.move(0, 0);
    await expect(auto.locator('..')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    const disabled = page.locator('.ob_results_header img[aria-disabled=true]').first();
    await expect(disabled).toBeVisible();
    await expect(disabled).toHaveCSS('border-style', 'dashed');
    await expect(disabled).toHaveCSS('background-color', 'rgb(221, 221, 221)');
    await expect(disabled).toHaveCSS('opacity', '1');
    await disabled.hover();
    await expect(disabled).toHaveCSS('background-color', 'rgb(221, 221, 221)');

    // Hold a real data refresh so loading and disabled styles can be inspected
    // without racing a fast local response.
    let refreshRequest;
    await page.route('**/json/test-data/default-dataset.json', route => { refreshRequest = route; });
    const refresh = page.getByRole('button', {name: 'Refresh', exact: true});
    await refresh.click();
    await expect.poll(() => Boolean(refreshRequest)).toBe(true);
    try {
        const status = page.getByRole('button', {name: /^Status:/});
        await expect(status).toHaveCSS('background-color', 'rgb(255, 202, 112)');
        await expect(refresh).toBeDisabled();
        await expect(refresh).toHaveCSS('border-style', 'dashed');
        await status.click();
        await expect(status).toHaveAttribute('aria-expanded', 'true');
        await expect(status).toHaveCSS('background-color', 'rgb(255, 202, 112)');
        await expect(status).toHaveCSS('box-shadow', 'rgb(0, 0, 0) 0px 0px 0px 2px inset');
        await status.click();
        await page.mouse.move(0, 0);
        await expect(status).toHaveAttribute('aria-expanded', 'false');
        await expect(status).toHaveCSS('background-color', 'rgb(255, 202, 112)');
    } finally {
        await refreshRequest.continue();
    }
    await ready(page);

    await page.getByAltText('Settings', {exact: true}).click();
    await page.getByRole('radio', {name: 'Default', exact: true}).check();
    await expect(page.locator('html')).toHaveAttribute('data-ob-theme', 'default');
    await expect(page.locator('.ob_results_header')).not.toHaveCSS('background-color', 'rgb(17, 17, 17)');
});
