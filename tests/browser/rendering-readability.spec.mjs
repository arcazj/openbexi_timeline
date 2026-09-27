import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';

async function ready(page) {
    await expect(page.locator('#demo-status')).toHaveAttribute('data-state', 'ready');
    await expect.poll(() => page.evaluate(async () => {
        const t = await (await import('/src/openbexi_demo.js')).demoReady;
        return !t.ob_results.pending && t.ob_viewport.headerHeight === t.ob_timeline_header.offsetHeight;
    })).toBe(true);
}

async function bands(page) {
    return page.evaluate(async () => {
        const t = await (await import('/src/openbexi_demo.js')).demoReady, s = t.ob_scene[0];
        return s.bands.filter(b => !b.name.includes('overview_')).map(b => ({
            name:b.name, position:b.intervalUnitPos, height:b.height,
            labels:s.getObjectByName(b.name).children.filter(c => c.userData.dateLabel).map(c => ({y:c.position.y, size:c.textHeight}))
        }));
    });
}

test('Grouped timelines keep one readable date axis at the top through paging and resizing', async ({page}) => {
    await page.goto('/demos.html?demo=ephemeris'); await ready(page);
    for (const height of [900, 420, 700]) {
        await page.setViewportSize({width:page.viewportSize().width, height}); await ready(page);
        for (let turn = 0; turn < 2; turn++) {
            const state = await bands(page);
            expect(state[0].labels.length).toBeGreaterThan(0);
            expect(state[0].position).toBe('TOP');
            expect(state[0].labels.every(label => label.size >= 12 && label.y > 0)).toBe(true);
            expect(state.slice(1).every(band => band.labels.length === 0)).toBe(true);
            await page.evaluate(async () => {
                const t = await (await import('/src/openbexi_demo.js')).demoReady;
                t.ob_viewport.go(Math.min(t.ob_viewport.pages.length - 1, t.ob_viewport.pageIndex + 1));
            });
            await ready(page);
        }
    }
});

test('An explicit per-band model retains separate bottom date axes', async ({page}) => {
    await page.route('**/models/demos/ephemeris.json', async route => {
        const response = await route.fetch(), model = await response.json();
        model.params[0].dateAxisMode = 'per-band';
        await route.fulfill({response, json:model});
    });
    await page.goto('/demos.html?demo=ephemeris'); await ready(page);
    const state = await bands(page);
    expect(state.length).toBeGreaterThan(1);
    expect(state.every(band => band.labels.length > 0 && band.position === 'BOTTOM')).toBe(true);
});

test('Perspective preserves complete readable plot bounds without black areas after resize and pan', async ({page}, info) => {
    const errors=[]; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/demos.html?demo=ephemeris'); await ready(page);
    await page.evaluate(async () => (await (await import('/src/openbexi_demo.js')).demoReady).ob_apply_perspective_camera(0));
    await ready(page);
    for (const width of [page.viewportSize().width, 960, 640]) {
        await page.setViewportSize({width,height:700}); await ready(page);
        const state=await page.evaluate(async () => {
            const t=await (await import('/src/openbexi_demo.js')).demoReady, s=t.ob_scene[0], c=s.ob_camera;
            const {Vector3}=await import('three');
            t.ob_render(0);
            const corners=[[-s.width/2,0],[-s.width/2,s.ob_height],[s.width/2,0],[s.width/2,s.ob_height]]
                .map(([x,y])=>new Vector3(x,y,24).project(c).toArray());
            const gl=s.ob_renderer.getContext(), pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
            gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            let black=0; for(let i=0;i<pixels.length;i+=4) if(pixels[i]<8 && pixels[i+1]<8 && pixels[i+2]<8) black++;
            return {type:c.type,background:s.background.getHexString(),corners,blackRatio:black/(pixels.length/4)};
        });
        expect(state.type).toBe('PerspectiveCamera');
        expect(state.background).toBe('f7f9fc');
        expect(state.corners.every(c=>Math.abs(c[0])<=1.001 && Math.abs(c[1])<=1.001)).toBe(true);
        expect(state.blackRatio).toBeLessThan(0.003);
        const box=await page.getByRole('region',{name:'Timeline events',exact:true}).boundingBox();
        await page.mouse.move(box.x+box.width*.35,box.y+box.height*.55);
        await page.mouse.down(); await page.mouse.move(box.x+box.width*.7,box.y+box.height*.55,{steps:8});
        await page.mouse.up(); await page.mouse.click(box.x+box.width*.7,box.y+box.height*.55);
        await ready(page);
    }
    if(process.env.RENDERING_CAPTURE_DIR) {
        await fs.mkdir(process.env.RENDERING_CAPTURE_DIR,{recursive:true});
        await page.screenshot({path:`${process.env.RENDERING_CAPTURE_DIR}/perspective-${info.project.name}.png`});
    }
    expect(errors).toEqual([]);
});
