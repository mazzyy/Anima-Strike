/**
 * The only bridge between the game and the main process.
 *
 * Deliberately tiny: three async calls, no key, no filesystem, no node.
 * Whatever the renderer does, it cannot read the Azure credentials.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lf', {
  /** Ask the model for a tactic. Resolves to null when unavailable. */
  requestTactic: (snapshot) => ipcRenderer.invoke('azure:tactic', snapshot),
  /** { configured, model, reason } — is the brain usable at all? */
  status: () => ipcRenderer.invoke('azure:status'),
  /** Running token/cost totals for the in-game opponent. */
  usage: () => ipcRenderer.invoke('azure:usage'),
});
