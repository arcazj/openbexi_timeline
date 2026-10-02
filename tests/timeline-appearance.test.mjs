import test from 'node:test';
import assert from 'node:assert/strict';
import {Color} from 'three';
import {createTimelineHarness} from './helpers/timeline-dom.mjs';
import {CONTRAST_COLORS, normalizeContrastColors, contrastText} from '../src/openbexi_timeline_appearance.js';

test('Saved contrast colors accept only known solid hex colors and choose readable text',()=>{
    const value = normalizeContrastColors({background:'#ABCDEF',filters:'url(https://example.invalid)',search:'#123',unknown:'#123456'});
    assert.equal(value.background,'#abcdef'); assert.equal(value.filters,'#ffffff'); assert.equal(value.search,'#ffffff');
    assert.equal(Object.hasOwn(value,'unknown'),false);
    assert.equal(contrastText('#000000'),'#ffffff'); assert.equal(contrastText('#ffffff'),'#000000');
    const luminance = color => color.slice(1).match(/../g).map(value=>parseInt(value,16)/255)
        .map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4)
        .reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    for(let r=0;r<=255;r+=17)for(let g=0;g<=255;g+=17)for(let b=0;b<=255;b+=17) {
        const color='#'+[r,g,b].map(channel=>channel.toString(16).padStart(2,'0')).join('');
        const a=luminance(color), c=luminance(contrastText(color));
        assert.ok((Math.max(a,c)+.05)/(Math.min(a,c)+.05)>=4.5,color);
    }
});

test('Contrast palette follows the selected theme, persists changes and resets without losing the theme',async()=>{
    const h=await createTimelineHarness();
    try {
        const api=await h.importModule('src/openbexi_timeline_appearance.js'), d=h.window.document;
        h.window.localStorage.setItem(api.CONTRAST_KEY,'{"background":"#223344","search":"invalid"}');
        api.restoreAppearance();
        const panel=d.createElement('section');d.body.append(panel);api.mountAppearance(panel,{name:'first'});
        const palette=panel.querySelector('.ob_contrast_colors');assert.equal(palette.hidden,true);
        panel.querySelector('input[value=contrast]').click();assert.equal(palette.hidden,false);
        assert.equal(palette.querySelectorAll('input[type=color]').length,CONTRAST_COLORS.length);
        assert.equal(palette.querySelector('[data-contrast-color=background]').value,'#223344');
        const filters=palette.querySelector('[data-contrast-color=filters]');
        filters.value='#003366';filters.dispatchEvent(new h.window.Event('input',{bubbles:true}));
        assert.equal(JSON.parse(h.window.localStorage.getItem(api.CONTRAST_KEY)).filters,'#003366');
        assert.equal(d.documentElement.style.getPropertyValue('--ob-contrast-filters-text'),'#ffffff');
        assert.equal(d.documentElement.dataset.obContrastCustom,'true');
        panel.querySelector('input[value=minimal]').click();assert.equal(palette.hidden,true);
        assert.equal(filters.value,'#003366');
        panel.querySelector('input[value=contrast]').click();palette.querySelector('button').click();
        assert.equal(filters.value,'#ffffff');assert.equal(d.documentElement.dataset.obContrastCustom,'false');
        assert.equal(d.documentElement.dataset.obTheme,'contrast');
    } finally {h.close();}
});

test('Invalid saved JSON and blocked browser storage leave color controls usable with a clear notice',async()=>{
    const h=await createTimelineHarness();
    try {
        const api=await h.importModule('src/openbexi_timeline_appearance.js'), d=h.window.document;
        h.window.localStorage.setItem(api.CONTRAST_KEY,'{invalid');api.restoreAppearance();
        assert.equal(d.documentElement.style.getPropertyValue('--ob-contrast-background'),'#111111');
        Object.defineProperty(h.window,'localStorage',{get(){throw new Error('Storage blocked');}});
        api.restoreAppearance();const panel=d.createElement('section');d.body.append(panel);api.mountAppearance(panel,{name:'blocked'});
        panel.querySelector('input[value=contrast]').click();
        const input=panel.querySelector('[data-contrast-color=background]');input.value='#ffffff';input.oninput();
        assert.equal(d.documentElement.style.getPropertyValue('--ob-contrast-background'),'#ffffff');
        assert.match(panel.querySelector('[role=status]').textContent,/cannot be saved/);
        panel.querySelector('.ob_contrast_colors button').click();assert.equal(input.value,'#111111');
    } finally {h.close();}
});

test('Multiple appearance panels stay synchronized without treating color inputs as theme radios',async()=>{
    const h=await createTimelineHarness();
    try {
        const api=await h.importModule('src/openbexi_timeline_appearance.js'),d=h.window.document;
        api.restoreAppearance();
        const panels=['one','two'].map(name=>{const panel=d.createElement('section');d.body.append(panel);api.mountAppearance(panel,{name});return panel;});
        panels[0].querySelector('input[value=contrast]').click();
        assert.ok(panels.every(panel=>!panel.querySelector('.ob_contrast_colors').hidden));
        const input=panels[0].querySelector('[data-contrast-color=scale]');input.value='#425364';input.oninput();
        assert.equal(panels[1].querySelector('[data-contrast-color=scale]').value,'#425364');
        assert.ok(panels.every(panel=>panel.querySelector('input[value=contrast]').checked));
    } finally {h.close();}
});

test('Workspace contrast temporarily changes clear-canvas backgrounds and restores each model color',async()=>{
    const h=await createTimelineHarness();
    try {
        const api=await h.importModule('src/openbexi_timeline_appearance.js');
        const scene={background:new Color('#123456')},other={background:new Color('#aabbcc')};
        const t={ob_scene:[scene,other],bands:[{color:'#bbccdd'}],rendering:{theme:{sceneBackground:'#123456'}}};
        api.applyAppearance('contrast');api.applyContrastColors({search:'#335577'});api.applyAppearanceBackground(t);
        assert.equal(scene.background.getHexString(),'123456','A menu-group edit leaves the workspace background alone');
        api.applyAppearance('contrast');api.applyContrastColors({background:'#001122'});api.applyAppearanceBackground(t);
        assert.equal(scene.background.getHexString(),'001122');assert.equal(other.background.getHexString(),'001122');
        assert.equal(t.bands[0].color,'#bbccdd');assert.equal(t.rendering.theme.sceneBackground,'#123456');
        api.applyContrastColors({background:'#ffcc00'});api.applyAppearanceBackground(t);
        api.applyAppearance('minimal');api.applyAppearanceBackground(t);
        assert.equal(scene.background.getHexString(),'123456');assert.equal(other.background.getHexString(),'aabbcc');
        api.applyAppearance('contrast');api.applyAppearanceBackground(t);
        assert.equal(scene.background.getHexString(),'ffcc00');
        api.applyContrastColors({});api.applyAppearanceBackground(t);
        assert.equal(scene.background.getHexString(),'123456');assert.equal(other.background.getHexString(),'aabbcc');
        api.applyContrastColors({background:'#111111',backgroundApplied:true});api.applyAppearanceBackground(t);
        assert.equal(scene.background.getHexString(),'111111','Explicitly selecting the default black still customizes the workspace');
    } finally {h.close();}
});
