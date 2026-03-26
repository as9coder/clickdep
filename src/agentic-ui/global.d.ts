export {};

declare global {
  interface Window {
    App?: {
      toast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
    };
  }
}
