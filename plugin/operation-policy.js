(function (root) {
  const owners = {
    generate: "jobActive",
    edit: "editorOpen",
    delete: "deletionOpen",
    associate: "associationOpen",
    import: "importOpen",
  };
  function operationCapabilities(state = {}, continuing = null) {
    const statuses = [state.job?.status, state.generationJob?.status, state.subtitleLoad?.status];
    const generating = statuses.some((status) => ["running", "canceling"].includes(status));
    const subtitleLoading = statuses.includes("loading");
    const loading = generating || subtitleLoading;
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
        const readOnlyPreflight =
          operation === "preflight" && subtitleLoading && !generating;
        return [operation, !occupied && (!loading || readOnlyPreflight)];
      }),
    );
  }
  const api = { operationCapabilities };
  if (typeof module !== "undefined") module.exports = api;
  else root.subtitleOperationPolicy = api;
})(typeof window !== "undefined" ? window : globalThis);
