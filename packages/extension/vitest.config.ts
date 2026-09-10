import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The content script is DOM code and its central guarantee — that no
    // anchor is ever modified — can only be tested against a real DOM.
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
  },
});
