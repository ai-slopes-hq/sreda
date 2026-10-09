// The renderer reaches the main process only through what is exposed here (`SredaBridge` in packages/ui).
import { contextBridge, ipcRenderer } from 'electron';

type Kind = 'group' | 'project';

contextBridge.exposeInMainWorld('sreda', {
  first: (): Promise<'starter' | null> => ipcRenderer.invoke('sreda:first'),
  settings: {
    skin: (): Promise<string | null> => ipcRenderer.invoke('settings:skin'),
    setSkin: (name: string): Promise<void> => ipcRenderer.invoke('settings:setSkin', name),
  },
  library: {
    folder: (): Promise<string | null> => ipcRenderer.invoke('library:folder'),
    choose: (): Promise<string | null> => ipcRenderer.invoke('library:choose'),
    list: (): Promise<{ kind: Kind; path: string }[]> => ipcRenderer.invoke('library:list'),
    read: (kind: Kind, path: string): Promise<unknown> => ipcRenderer.invoke('library:read', kind, path),
    exists: (kind: Kind, path: string): Promise<boolean> => ipcRenderer.invoke('library:exists', kind, path),
    write: (kind: Kind, path: string, doc: unknown): Promise<void> =>
      ipcRenderer.invoke('library:write', kind, path, doc),
    samples: (): Promise<string[]> => ipcRenderer.invoke('library:samples'),
    readSample: (path: string): Promise<ArrayBuffer> => ipcRenderer.invoke('library:readSample', path),
    importSample: (name: string, bytes: ArrayBuffer): Promise<string> =>
      ipcRenderer.invoke('library:importSample', name, bytes),
  },
});
