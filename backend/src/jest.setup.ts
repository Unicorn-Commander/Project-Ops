import { jest as jestObject } from '@jest/globals';

Object.defineProperty(globalThis, 'jest', {
  configurable: true,
  value: jestObject,
});
