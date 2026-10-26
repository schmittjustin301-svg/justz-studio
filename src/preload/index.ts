import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { JustzApi, MenuAction, ProgressEvent } from '../shared/api'

const api: JustzApi = {
  getEnvironment: () => ipcRenderer.invoke('env:get'),
  saveSettings: (s) => ipcRenderer.invoke('env:saveSettings', s),
  pathForFile: (file) => webUtils.getPathForFile(file),
  chooseVideo: () => ipcRenderer.invoke('dialog:video'),
  chooseMusic: () => ipcRenderer.invoke('dialog:music'),
  chooseFolder: () => ipcRenderer.invoke('dialog:folder'),
  chooseExportPath: (name) => ipcRenderer.invoke('dialog:exportPath', name),
  importMedia: (jobId, path) => ipcRenderer.invoke('media:import', jobId, path),
  saveProject: (project, path) => ipcRenderer.invoke('project:save', project, path),
  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),
  loadProject: (path) => ipcRenderer.invoke('project:load', path),
  downloadModel: (jobId, id) => ipcRenderer.invoke('whisper:download', jobId, id),
  transcribe: (jobId, media, language, model) => ipcRenderer.invoke('whisper:transcribe', jobId, media, language, model),
  exportVideo: (jobId, project, preset, outPath) => ipcRenderer.invoke('export:video', jobId, project, preset, outPath),
  previewFrame: (project, preset, t) => ipcRenderer.invoke('export:frame', project, preset, t),
  cancel: (jobId) => ipcRenderer.invoke('job:cancel', jobId),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  savePreset: (p) => ipcRenderer.invoke('presets:save', p),
  deletePreset: (id) => ipcRenderer.invoke('presets:delete', id),
  showInFolder: (path) => ipcRenderer.invoke('shell:showInFolder', path),
  onProgress: (cb) => {
    const fn = (_e: unknown, p: ProgressEvent): void => cb(p)
    ipcRenderer.on('progress', fn)
    return () => ipcRenderer.removeListener('progress', fn)
  },
  onMenu: (cb) => {
    const fn = (_e: unknown, a: MenuAction): void => cb(a)
    ipcRenderer.on('menu', fn)
    return () => ipcRenderer.removeListener('menu', fn)
  }
}

contextBridge.exposeInMainWorld('justz', api)
