// What the Electron preload exposes as `window.sreda` (packages/app/src/preload): the main process's services.
export interface SredaBridge {
  /** e2e runs ask for the starter patch on a first launch instead of the factory project Pulse */
  first(): Promise<'starter' | null>;
}

declare global {
  interface Window {
    sreda?: SredaBridge;
  }
}
