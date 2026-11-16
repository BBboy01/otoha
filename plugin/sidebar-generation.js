(() => {
  window.createGenerationControls = ({ post, getSelection, onModeChanged }) => {
    const modes = document.querySelectorAll("input[name='generation-mode']");
    const retranslate = document.querySelector("#retranslate-subtitle");
    const importButton = document.querySelector("#import-subtitle");
    const force = document.querySelector("#force-transcription");
    for (const input of modes) input.addEventListener("change", () => onModeChanged(input.value));
    retranslate?.addEventListener("click", () => {
      if (retranslate.disabled) return;
      const selection = getSelection();
      post("start", { ...selection, generationMode: "translate", inputSubtitlePath: selection.subtitlePath });
    });
    importButton?.addEventListener("click", () => {
      if (!importButton.disabled) post("importSubtitle", getSelection());
    });
    return {
      update({ busy, state, selectedSubtitlePath, sourceLanguage, targetLanguage }) {
        const locked = busy || state.editorOpen || state.associationOpen || state.importOpen;
        const valid = state.media && sourceLanguage && targetLanguage && sourceLanguage !== targetLanguage;
        for (const input of modes) input.disabled = locked;
        if (force) force.disabled = locked;
        if (retranslate) retranslate.disabled = locked || !valid || !selectedSubtitlePath;
        if (importButton) importButton.disabled = locked || !valid;
        const hint = valid ? "" : "请先选择不同的源语言和目标语言";
        if (retranslate) retranslate.title = hint;
        if (importButton) importButton.title = hint;
      },
    };
  };
})();
