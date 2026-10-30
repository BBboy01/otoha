const PROTOCOL_VERSION = 1;

const EVENT_TYPES = Object.freeze(["phase", "completed", "cancelled", "error"]);
const JOB_PHASES = Object.freeze([
  "checkingEnvironment",
  "preparingLanguageResources",
  "extractingAudio",
  "transcribing",
  "translating",
  "saving",
  "loading",
]);
const ERROR_CODES = Object.freeze([
  "helper.invalidRequest",
  "helper.unsupportedSystem",
  "helper.unknown",
  "ffmpeg.notFound",
  "ffmpeg.invalidAudioStream",
  "ffmpeg.extractionFailed",
  "speech.unsupportedLanguage",
  "speech.noAudio",
  "speech.noSpeech",
  "speech.missingFormat",
  "translation.failed",
  "subtitle.incompleteTranslation",
  "subtitle.publishFailed",
  "subtitle.libraryFailed",
  "subtitle.loadFailed",
  "job.cancelled",
]);

function protocolError(message) {
  return new Error(`helper protocol: ${message}`);
}

function parseHelperEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("event must be an object");
  }
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    throw protocolError(`protocolVersion must be ${PROTOCOL_VERSION}`);
  }
  if (typeof value.type !== "string" || !EVENT_TYPES.includes(value.type)) {
    throw protocolError("event type is unsupported");
  }
  if (typeof value.jobId !== "string" || !value.jobId.trim()) {
    throw protocolError("jobId is required");
  }

  if (value.type === "phase") {
    if (typeof value.phase !== "string" || !JOB_PHASES.includes(value.phase)) {
      throw protocolError("phase is unsupported");
    }
    if (value.progress !== undefined &&
        (typeof value.progress !== "number" || !Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1)) {
      throw protocolError("progress must be between 0 and 1");
    }
  }
  if (value.type === "completed" && (typeof value.path !== "string" || !value.path.startsWith("/"))) {
    throw protocolError("completed event requires an absolute path");
  }
  if (value.type === "error") {
    if (typeof value.code !== "string" || !ERROR_CODES.includes(value.code)) {
      throw protocolError("error code is unsupported");
    }
    if (typeof value.message !== "string" || !value.message.trim()) {
      throw protocolError("error event requires a message");
    }
  }
  return value;
}

module.exports = {
  ERROR_CODES,
  EVENT_TYPES,
  JOB_PHASES,
  PROTOCOL_VERSION,
  parseHelperEvent,
};
