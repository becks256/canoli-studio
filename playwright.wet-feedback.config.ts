import { defineConfig } from '@playwright/test';
import production from './playwright.production.config';

/** Use an ordinary production build: the probe verifies developer globals are absent. */
export default defineConfig({
  ...production,
  testMatch: '**/wet-feedback-production.e2e.ts',
});
