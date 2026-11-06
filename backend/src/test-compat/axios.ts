import { jest } from '@jest/globals';

export const post = jest.fn();

const axios = { post };

export default axios;
