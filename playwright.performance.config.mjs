import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({...base,
    testMatch: /[\\/]performance\.spec\.mjs$/,
    testIgnore: [],
    projects: [{name:'performance',use:{viewport:{width:1280,height:800}}}],
    timeout:120_000
});
