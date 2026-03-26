import { mountAgenticPage } from './mount';

export type AgenticCodeApi = {
  mount: (container: HTMLElement) => () => void;
};

declare global {
  interface Window {
    AgenticCode: AgenticCodeApi;
  }
}

window.AgenticCode = {
  mount: mountAgenticPage,
};
