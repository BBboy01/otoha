function createJobController() {
  let active = null;

  return {
    begin(input) {
      if (active) return null;
      active = {
        id: input.id,
        cancelPath: input.cancelPath || null,
        mediaPath: input.mediaPath || null,
        parser: null,
        terminal: false,
        cancelRequested: false,
        completion: null,
        fileLoadedSequence: input.fileLoadedSequence ?? null,
        mediaOperation: input.mediaOperation || null,
        languages: input.languages || null,
      };
      return active;
    },
    current() {
      return active;
    },
    matches({ id, mediaPath, fileLoadedSequence } = {}) {
      return Boolean(active)
        && active.id === id
        && (mediaPath === undefined || active.mediaPath === mediaPath)
        && (fileLoadedSequence === undefined || active.fileLoadedSequence === fileLoadedSequence);
    },
    markTerminal() {
      if (active) active.terminal = true;
    },
    requestCancel() {
      if (!active) return null;
      active.cancelRequested = true;
      return active;
    },
    setCompletion(promise) {
      if (active) active.completion = promise;
      return promise;
    },
    reset() {
      active = null;
    },
  };
}

module.exports = { createJobController };
