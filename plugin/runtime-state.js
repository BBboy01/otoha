function idleJob() {
  return {
    jobId: null,
    status: "idle",
    phase: "",
    message: "",
    progress: null,
    path: null,
    loaded: false,
    errorCode: null,
  };
}

function projectJob(state, jobActive) {
  const job = state.feedbackSource === "load" ? state.subtitleLoad : state.job;
  const library = state.subtitleLibrary;
  if (library.error && !jobActive && job.status === "idle") {
    return {
      ...idleJob(),
      status: library.files.length ? "available" : "error",
      message: library.error.message,
      errorCode: library.error.code,
      path: state.subtitleLoad.path,
    };
  }
  return job;
}

module.exports = { idleJob, projectJob };
