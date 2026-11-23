(() => {
  const LANGUAGES = [
    ["en", "English"],
    ["zh-Hans", "简体中文"],
    ["zh-Hant", "繁體中文"],
    ["ja", "日本語"],
    ["ko", "한국어"],
    ["fr", "Français"],
    ["de", "Deutsch"],
    ["es", "Español"],
    ["it", "Italiano"],
    ["pt-BR", "Português (Brasil)"],
    ["ru", "Русский"],
    ["ar", "العربية"],
    ["hi", "हिन्दी"],
    ["th", "ไทย"],
    ["vi", "Tiếng Việt"],
  ];
  const elements = {
    audioTrack: document.querySelector("#audio-track"),
    cancel: document.querySelector("#cancel-button"),
    displayMode: document.querySelector("#display-mode"),
    displayModes: document.querySelectorAll("input[name='display-mode']"),
    exportButton: document.querySelector("#export-button"),
    exportMessage: document.querySelector("#export-message"),
    exportResult: document.querySelector("#export-result"),
    exportModes: document.querySelectorAll("input[name='export-mode']"),
    existingSubtitles: document.querySelector("#existing-subtitles"),
    editSubtitle: document.querySelector("#edit-subtitle-button"),
    jobForm: document.querySelector("#job-form"),
    jobMessage: document.querySelector("#job-message"),
    jobAnnouncement: document.querySelector("#job-announcement"),
    jobElapsed: document.querySelector("#job-elapsed"),
    jobStatus: document.querySelector("#job-status"),
    jobIcon: document.querySelector("#job-icon"),
    jobDetailToggle: document.querySelector("#job-detail-toggle"),
    jobDetailMessage: document.querySelector("#job-detail-message"),
    progressDrawer: document.querySelector("#job-progress"),
    languageResourceStatus: document.querySelector("#language-resource-status"),
    languageResourceMessage: document.querySelector(
      "#language-resource-message",
    ),
    checkLanguages: document.querySelector("#check-languages"),
    mediaError: document.querySelector("#media-error"),
    mediaName: document.querySelector("#media-name"),
    progress: document.querySelector("#translation-progress"),
    reveal: document.querySelector("#reveal-button"),
    revealExport: document.querySelector("#reveal-export-button"),
    retry: document.querySelector("#retry-button"),
    sourceLanguage: document.querySelector("#source-language"),
    sourceLanguageError: document.querySelector("#source-language-error"),
    start: document.querySelector("#start-button"),
    subtitleChoice: document.querySelector("#subtitle-choice"),
    subtitleVersion: document.querySelector("#subtitle-version"),
    subtitleLoaded: document.querySelector("#subtitle-loaded"),
    targetLanguage: document.querySelector("#target-language"),
    targetLanguageError: document.querySelector("#target-language-error"),
  };
  function fillLanguages(select, selected) {
    window.updateSidebarOptions(
      select,
      [
        { label: "选择语言", value: "" },
        ...LANGUAGES.map(([value, label]) => ({ value, label })),
      ],
      selected || "",
    );
  }
  function trackLabel(track) {
    const title =
      track.title ||
      (track.lang ? track.lang.toUpperCase() : `音轨 ${track.id}`);
    return track.available ? title : `${title}（不可读取）`;
  }

  window.sidebarRenderer = { elements, LANGUAGES, fillLanguages, trackLabel };
})();
(() => {
  const keys = new WeakMap();
  window.updateSidebarOptions = (select, options, value) => {
    const key = JSON.stringify(options);
    const changed = keys.get(select) !== key;
    if (changed) {
      select.replaceChildren();
      for (const item of options) {
        const option = new Option(item.label, item.value);
        option.disabled = Boolean(item.disabled);
        option.setAttribute?.("aria-label", item.label);
        select.add(option);
      }
      keys.set(select, key);
    }
    if (changed || select.value !== value) select.value = value;
  };
})();
