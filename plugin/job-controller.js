function createJobController({
  now = Date.now,
  schedule = setTimeout,
  unschedule = clearTimeout,
  presentationTimeout = 5000,
} = {}) {
  let active = null;
  let finishPresentation = null;

  function releaseStart(id, ready = true) {
    if (!active || active.id !== id || !finishPresentation) return false;
    finishPresentation(ready);
    return true;
  }

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
      if (input.deferStart) {
        active.presentation = new Promise((resolve) => {
          let timer;
          finishPresentation = (ready) => {
            unschedule(timer);
            finishPresentation = null;
            resolve(ready);
          };
          timer = schedule(
            () => releaseStart(input.id, false),
            presentationTimeout,
          );
        });
      }
      return active;
    },
    releaseStart,
    current() {
      return active;
    },
    withTiming(job) {
      if (!active || active.id !== job.jobId) return job;
      if (
        !["running", "loading"].includes(job.status) &&
        active.finishedAt === null
      ) {
        active.finishedAt = now();
      }
      return {
        ...job,
        startedAt: active.startedAt,
        finishedAt: active.finishedAt,
      };
    },
    matches({ id, mediaPath, fileLoadedSequence } = {}) {
      return (
        Boolean(active) &&
        active.id === id &&
        (mediaPath === undefined || active.mediaPath === mediaPath) &&
        (fileLoadedSequence === undefined ||
          active.fileLoadedSequence === fileLoadedSequence)
      );
    },
    markTerminal() {
      if (active) {
        active.terminal = true;
        releaseStart(active.id, false);
      }
    },
    requestCancel() {
      if (!active) return null;
      active.cancelRequested = true;
      releaseStart(active.id, false);
      return active;
    },
    setCompletion(promise) {
      if (active) active.completion = promise;
      return promise;
    },
    reset() {
      if (active) releaseStart(active.id, false);
      active = null;
    },
  };
}

module.exports = { createJobController };
