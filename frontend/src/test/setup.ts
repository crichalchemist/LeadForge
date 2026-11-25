import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetMedia } from './media';

// This suite imports vitest explicitly rather than enabling globals, so Testing Library cannot register
// its own cleanup; it happens here, with the other per-test resets.
afterEach(() => {
  cleanup();
  resetMedia();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});
