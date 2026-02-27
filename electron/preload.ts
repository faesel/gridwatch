import { ipcRenderer, contextBridge, webFrame } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld('gridwatchAPI', {
  getSessions: () => ipcRenderer.invoke('sessions:get-all'),
  getLogTokens: () => ipcRenderer.invoke('sessions:get-log-tokens'),
  renameSession: (sessionId: string, newSummary: string) =>
    ipcRenderer.invoke('sessions:rename', sessionId, newSummary),
  archiveSession: (sessionId: string) =>
    ipcRenderer.invoke('sessions:archive', sessionId),
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke('sessions:delete', sessionId),
  setTags: (sessionId: string, tags: string[]) =>
    ipcRenderer.invoke('sessions:set-tags', sessionId, tags),
  setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),
  getZoomFactor: () => webFrame.getZoomFactor(),
  checkForUpdate: () => ipcRenderer.invoke('app:check-for-update'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
})
