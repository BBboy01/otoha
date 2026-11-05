const { createSubtitleDeletionController } = require("./subtitle-deletion-controller.js");

function createSubtitleDeletionRuntime({ getContext, send, onChanged, exec, settings, library, currentMediaPath, outputDirectoryPath, refresh, clearOutput }) {
  return createSubtitleDeletionController({
    getContext,
    send,
    onChanged,
    exec,
    async onDeleted(path, mediaPath, rootPath) {
      settings.forgetSelection(mediaPath, path);
      if (currentMediaPath() !== mediaPath || outputDirectoryPath() !== rootPath) return;
      clearOutput(path);
      library.removeFile(path);
      await refresh(mediaPath);
    },
  });
}

module.exports = { createSubtitleDeletionRuntime };
