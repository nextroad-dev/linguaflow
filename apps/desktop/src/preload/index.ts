import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
      ipcRenderer.on(channel, wrapped);

      return () => {
        ipcRenderer.removeListener(channel, wrapped);
      };
    }
  }
});
