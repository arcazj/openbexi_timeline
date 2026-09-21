import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';

const spec = JSON.parse(await fs.readFile(new URL('../../swagger/openapi-v1.json', import.meta.url), 'utf8'));
const methods = ['get', 'post', 'put', 'patch', 'delete'];
const endpoints = Object.entries(spec.paths).flatMap(([path, definition]) =>
    methods.filter(method => definition[method]).map(method => method.toUpperCase() + '/api/v1' + path));

test('API reference renders the local contract when the Java server is unavailable', async ({page}) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const health = page.waitForResponse(response => response.url().endsWith('/api/v1/health'));
    await page.goto('/docs/api.html');
    expect((await health).status()).toBe(404);
    await expect(page.getByRole('heading', {name: 'OpenBEXI Timeline REST API', exact: true})).toBeVisible();
    await expect(page.locator('#api-state')).toContainText('Live queries are unavailable on this host.');
    await expect(page.getByRole('combobox', {name: 'Dataset', exact: true})).toBeDisabled();
    await expect(page.getByRole('button', {name: 'GET events', exact: true})).toBeDisabled();
    await expect(page.locator('#endpoints > .endpoint > summary')).toHaveText(endpoints);
    await page.locator('#endpoints > .endpoint > summary').first().click();
    await expect(page.locator('#endpoints > .endpoint').first()).toHaveAttribute('open', '');
    await expect(page.locator('#endpoints > .endpoint').first().locator('p').first()).toContainText(spec.paths['/health'].get.summary);
    await expect(page.getByRole('link', {name: 'Download OpenAPI', exact: true})).toHaveAttribute('href', '../swagger/openapi-v1.json');
    expect(errors).toEqual([]);
});

test('Public API explorer encodes the selected query and renders JSON responses as text', async ({page}) => {
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v1/health', route => route.fulfill({json: {apiVersion: '1'}}));
    await page.route('**/api/v1/datasets', route => route.fulfill({json: {items: [
        {id: 'monet', title: 'Claude Monet'}, {id: 'dinausaurs', title: 'Dinosaurs'}
    ]}}));
    await page.route('**/api/v1/datasets/*/events?*', async route => {
        requests.push({url: route.request().url(), method: route.request().method(), headers: route.request().headers()});
        const status = requests.length === 1 ? 200 : 400;
        await route.fulfill({status, json: status === 200 ?
            {items: [{id: 'public-event', data: {title: '<img src=x onerror=alert(1)>'}}], nextOffset: null} :
            {title: 'Invalid query', status: 400, detail: 'Search could not be applied.'}});
    });
    await page.goto('/docs/api.html');
    await expect(page.locator('#api-state')).toHaveText('Java API v1 is available.');
    const dataset = page.getByRole('combobox', {name: 'Dataset', exact: true});
    await expect(dataset.locator('option')).toHaveText(['Claude Monet', 'Dinosaurs']);
    await dataset.selectOption('dinausaurs');
    const search = 'age > 100 & café / ?kind=session#fragment';
    await page.getByRole('textbox', {name: 'Search', exact: true}).fill(search);
    const query = page.getByRole('button', {name: 'GET events', exact: true});
    await query.click();
    const output = page.locator('#result');
    await expect(output).toContainText('200 OK');
    await expect(output).toContainText('<img src=x onerror=alert(1)>');
    await expect(output.locator('img')).toHaveCount(0);
    const request = requests[0], url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(request.headers.authorization).toBeUndefined();
    expect(url.pathname).toBe('/api/v1/datasets/dinausaurs/events');
    expect([...url.searchParams]).toEqual([['limit', '10'], ['search', search]]);
    expect(url.hash).toBe('');
    await expect(query).toBeEnabled();

    await page.getByRole('textbox', {name: 'Search', exact: true}).fill('');
    await query.click();
    await expect(output).toContainText('400 Bad Request');
    await expect(output).toContainText('Search could not be applied.');
    expect(new URL(requests[1].url).searchParams.has('search')).toBe(false);
    await expect(query).toBeEnabled();
    expect(errors).toEqual([]);
});
