import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';

// Functional checks use the real rendering engine without sharing pixel baselines.
export default defineConfig({...base,
    testMatch: /usability\.spec\.mjs$/,
    // Allow the first software WebGL context in each engine to initialize.
    expect:{...base.expect,timeout:45_000},
    timeout:120_000,
    projects: [
        {name:'phone', use:{browserName:'chromium',viewport:{width:390,height:844},hasTouch:true,isMobile:true}},
        {name:'firefox', use:{browserName:'firefox',viewport:{width:1280,height:800},launchOptions:{}}},
        {name:'webkit', use:{browserName:'webkit',viewport:{width:1280,height:800},launchOptions:{}}}
    ]
});
