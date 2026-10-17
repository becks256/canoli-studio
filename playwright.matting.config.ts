import {defineConfig} from '@playwright/test';
import base from './playwright.config';
// Explicit local research-data gate; never silently downloads data or joins default CI.
export default defineConfig({...base,testDir:'./benchmarks',testMatch:'matting-natural.e2e.ts',testIgnore:[],timeout:180_000});
