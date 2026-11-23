(function (root) {
  const owners = {
    generate: "jobActive",
    edit: "editorOpen",
    delete: "deletionOpen",
    associate: "associationOpen",
    import: "importOpen",
  };
  function operationCapabilities(state = {}, continuing = null) {
    const loading = ["running", "canceling", "loading"].includes(
      state.job?.status,
    );
    return Object.fromEntries(
      [
        "generate",
        "load",
        "edit",
        "delete",
        "associate",
        "import",
        "display",
        "style",
        "export",
        "configure",
        "preflight",
      ].map((operation) => {
        const occupied = Object.entries(owners).some(
          ([owner, flag]) =>
            !(operation === continuing && owner === continuing) && state[flag],
        );
        return [operation, !occupied && !loading];
      }),
    );
  }
  const api = { operationCapabilities };
  if (typeof module !== "undefined") module.exports = api;
  else root.subtitleOperationPolicy = api;
})(typeof window !== "undefined" ? window : globalThis);
