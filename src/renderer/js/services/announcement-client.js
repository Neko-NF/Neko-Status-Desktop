(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.services = window._nekoModules.services || {};

  const ipcClient = () => window._nekoModules?.services?.IpcClient;

  function isReady() {
    return !!ipcClient()?.isReady?.();
  }

  function invoke(methodName, ...args) {
    return ipcClient().invoke(methodName, ...args);
  }

  const AnnouncementClient = {
    isReady,
    fetch: (options) => invoke('fetchAnnouncements', options),
    create: (payload) => invoke('createAnnouncement', payload),
    update: (id, payload) => invoke('updateAnnouncement', id, payload),
    delete: (id) => invoke('deleteAnnouncement', id),
    recordReceipt: (id, action) => invoke('recordAnnouncementReceipt', id, action),
  };

  window._nekoModules.services.AnnouncementClient = AnnouncementClient;
})();
