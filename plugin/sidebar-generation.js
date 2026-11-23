(() => {
  window.createGenerationControls = ({
    post,
    getSelection,
    onModeChanged,
    onSourceChanged,
    onStrategyChanged,
  }) => {
    const modes = document.querySelectorAll("input[name='generation-mode']");
    const sources = document.querySelectorAll("input[name='generation-source']");
    const strategies = document.querySelectorAll("input[name='transcription-strategy']");
    const audioFields = document.querySelector("#audio-generation-fields");
    const existingFields = document.querySelector("#existing-subtitle-generation-fields");
    const importButton = document.querySelector("#import-subtitle");
    for (const input of modes) input.addEventListener("change", () => onModeChanged(input.value));
    for (const input of sources) input.addEventListener("change", () => onSourceChanged(input.value));
    for (const input of strategies) input.addEventListener("change", () => onStrategyChanged(input.value));
    importButton?.addEventListener("click", () => {
      if (!importButton.disabled) post("importSubtitle", getSelection());
    });
    return {
      update({ busy, state, sourceMode, sourceLanguage, targetLanguage }) {
        const locked = !window.subtitleOperationPolicy.operationCapabilities(state).configure;
        const valid = state.media && sourceLanguage && targetLanguage && sourceLanguage !== targetLanguage;
        const existing = sourceMode === "existing-subtitle";
        for (const input of modes) input.disabled = locked || existing;
        for (const input of sources) {
          input.checked = input.value === sourceMode;
          input.disabled = locked;
        }
        for (const input of strategies) input.disabled = locked || existing;
        if (audioFields) audioFields.hidden = existing;
        if (existingFields) existingFields.hidden = !existing;
        if (importButton) {
          importButton.disabled = locked || !valid;
          importButton.title = valid ? "导入 SRT" : "请先选择不同的源语言和目标语言";
          importButton.setAttribute("aria-label", "导入 SRT");
        }
      },
    };
  };
})();
