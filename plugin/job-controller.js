function createJobController({ now = Date.now } = {}) {
  let active = null;

  return {
    begin(input) {
      if (active) return null;
      active = {
        id: input.id,
        startedAt: now(),
        finishedAt: null,
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
    withTiming(job) {
      if (!active || active.id !== job.jobId) return job;
      if (!["running", "loading"].includes(job.status) && active.finishedAt === null) {
        active.finishedAt = now();
      }
      return { ...job, startedAt: active.startedAt, finishedAt: active.finishedAt };
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
