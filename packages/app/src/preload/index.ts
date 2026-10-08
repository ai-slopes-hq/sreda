// The renderer reaches the main process only through what is exposed here (`SredaBridge` in packages/ui).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('sreda', {
  first: (): Promise<'starter' | null> => ipcRenderer.invoke('sreda:first'),
});
