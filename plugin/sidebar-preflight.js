(() => {
  window.createSidebarPreflight = (post) => {
    let lastKey = "";
    return (view, force = false) => {
      const { preflight, capabilities } = view;
      if (!preflight.valid) {
        lastKey = "";
        return;
      }
      if (!capabilities.preflight) return;
      if (force || preflight.key !== lastKey) {
        lastKey = preflight.key;
        if (force || !preflight.check || preflight.check.status !== "ready")
          post("checkLanguages", { ...preflight.request, force });
      }
    };
  };
})();
