import { mountAgenticPage } from './mount';

export type AgenticCodeApi = {
  mount: (container: HTMLElement) => () => void;
};

/**
 * Named export `mount` becomes the IIFE return value for esbuild --format=iife --global-name=AgenticCode
 * (default export would interop to `.default` and break `AgenticCode.mount` in app.js).
 */
export const mount = mountAgenticPage;
