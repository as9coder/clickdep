export {};

declare global {
  interface Window {
    App?: {
      baseDomain?: string;
      toast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
    };
    API?: {
      resolveUrl: (path: string) => string;
      recordDashboardOrigin?: () => void;
    };
  }
}
