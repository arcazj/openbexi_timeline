import {test,expect} from '@playwright/test';

async function ready(page) {
    await expect.poll(()=>page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return Boolean(t.ob_results.pending || t.ob_results.fetching || t.ob_results.explorer.seeking);
    })).toBe(false);
}
async function settings(page) {
    const more=page.getByRole('button',{name:'More',exact:true});
    if(await more.isVisible())await more.click();
    await page.getByAltText('Settings',{exact:true}).click();
    await expect(page.getByRole('button',{name:'Model and YAML editor',exact:true})).toBeVisible();
}
const ratio=(a,b)=>{
    const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255)
        .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);
};

test('Model and YAML editor stays prominent and readable in every theme',async({page})=>{
    await page.goto('/demos.html?demo=default-dataset');await ready(page);await settings(page);
    const launch=page.getByRole('button',{name:'Model and YAML editor',exact:true});
    for(const name of ['Default','Apple style','Windows style','Minimal','High contrast']) {
        await page.getByRole('radio',{name,exact:true}).check();await page.mouse.move(0,0);
        const colors=await launch.evaluate(node=>{
            const css=getComputedStyle(node),panel=getComputedStyle(node.closest('.ob_viewport_side'));
            return {text:css.color,button:css.backgroundColor,panel:panel.backgroundColor};
        });
        expect(ratio(colors.text,colors.button),name+' text').toBeGreaterThanOrEqual(4.5);
        expect(ratio(colors.button,colors.panel),name+' button').toBeGreaterThanOrEqual(3);
        await launch.focus();await expect(launch).toHaveCSS('outline-width','3px');
    }
});

test('Custom contrast colors persist, follow controls into More and reset cleanly',async({page},info)=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/demos.html?demo=default-dataset');await ready(page);await settings(page);
    const palette=page.locator('.ob_contrast_colors');await expect(palette).toBeHidden();
    await page.getByRole('radio',{name:'High contrast',exact:true}).check();await expect(palette).toBeVisible();
    expect(await palette.evaluate(node=>node.previousElementSibling.textContent.trim())).toBe('High contrast');
    const original=await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return {scene:t.ob_scene[0].background.getHexString(),bands:t.ob_scene[0].bands.map(band=>band.color),rendering:JSON.stringify(t.rendering)};
    });
    await page.getByLabel('Search color',{exact:true}).fill('#004400');
    await expect(page.locator('.ob_timeline_right_panel')).toHaveCSS('background-color','rgb(255, 255, 255)');
    expect(await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_scene[0].background.getHexString())).toBe(original.scene);
    await page.getByLabel('Overall background color',{exact:true}).fill('#001122');
    await expect(page.locator('.ob_timeline_right_panel')).toHaveCSS('background-color','rgb(0, 17, 34)');
    const panelColors=await palette.evaluate(node=>({color:getComputedStyle(node).color,background:getComputedStyle(node.closest('.ob_timeline_right_panel')).backgroundColor}));
    expect(ratio(panelColors.color,panelColors.background)).toBeGreaterThanOrEqual(4.5);
    await page.getByLabel('Overall background color',{exact:true}).fill('#f5e6c8');
    await page.getByLabel('Calendar and filters color',{exact:true}).fill('#003366');
    await page.getByLabel('Search color',{exact:true}).fill('#004400');
    await page.getByLabel('Auto scale and view lock color',{exact:true}).fill('#f5ddff');
    await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.mouse.move(0,0);
    const filters=page.getByRole('button',{name:'Filters',exact:true});
    await expect(page.locator('.ob_results_header')).toHaveCSS('background-color','rgb(245, 230, 200)');
    await expect(page.locator('.ob_timeline_panel')).toHaveCSS('background-color','rgb(245, 230, 200)');
    expect(await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        return {scene:t.ob_scene[0].background.getHexString(),bands:t.ob_scene[0].bands.map(band=>band.color),rendering:JSON.stringify(t.rendering)};
    })).toEqual({...original,scene:'f5e6c8'});
    const search=page.getByRole('searchbox',{name:'Search',exact:true});await search.fill('data');await search.press('Enter');await ready(page);
    await page.evaluate(async()=>{
        const t=await(await import('/src/openbexi_demo.js')).demoReady;
        t.ob_results.controls.changeFilter(t.ob_scene[0].ob_filter_value,t.ob_scene[0].ob_filter_name,'namespace');
    });await ready(page);
    expect(await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_scene[0].background.getHexString())).toBe('f5e6c8');
    await expect(filters).toHaveCSS('background-color','rgb(0, 51, 102)');await expect(filters).toHaveCSS('color','rgb(255, 255, 255)');
    await expect(page.getByRole('searchbox',{name:'Search',exact:true})).toHaveCSS('background-color','rgb(0, 68, 0)');
    await page.reload();await ready(page);await settings(page);
    await expect(page.getByLabel('Calendar and filters color',{exact:true})).toHaveValue('#003366');
    await page.getByRole('radio',{name:'Minimal',exact:true}).check();await expect(palette).toBeHidden();
    expect(await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_scene[0].background.getHexString())).toBe(original.scene);
    await expect(page.locator('.ob_results_header')).toHaveCSS('background-color','rgb(255, 255, 255)');
    await page.getByRole('radio',{name:'High contrast',exact:true}).check();
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await page.setViewportSize({width:390,height:844});await ready(page);
    expect(await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_scene[0].background.getHexString())).toBe('f5e6c8');
    await page.getByRole('button',{name:'More',exact:true}).click();await page.mouse.move(0,0);
    await expect(filters).toBeVisible();await expect(filters).toHaveCSS('background-color','rgb(0, 51, 102)');
    await expect(page.locator('.ob_more_panel')).toHaveCSS('background-color','rgb(245, 230, 200)');
    await expect(page.getByLabel('Lock current view',{exact:true}).locator('..')).toHaveCSS('background-color','rgb(245, 221, 255)');
    await page.screenshot({path:info.outputPath('custom-contrast-phone.png')});
    await page.getByAltText('Settings',{exact:true}).click();
    await page.getByRole('button',{name:'Reset high contrast colors',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-ob-contrast-custom','false');
    await expect(page.getByLabel('Overall background color',{exact:true})).toHaveValue('#111111');
    expect(await page.evaluate(async()=>(await(await import('/src/openbexi_demo.js')).demoReady).ob_scene[0].background.getHexString())).toBe(original.scene);
    await page.getByRole('button',{name:'Close settings',exact:true}).click();
    await expect(page.locator('.ob_results_header')).toHaveCSS('background-color','rgb(17, 17, 17)');
    expect(errors).toEqual([]);
});
