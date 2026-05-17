const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nekoPrivacyPicker', {
  submitSelection(token, value) {
    ipcRenderer.send(`privacy-picker-result-${token}`, value ?? null);
  },
});
