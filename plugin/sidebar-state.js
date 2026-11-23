(function (root) {
  const policy =
    typeof module !== "undefined"
      ? require("./operation-policy.js")
      : root.subtitleOperationPolicy;
  function deriveSidebarState(state, selection = {}, previous = {}) {
    const mediaPath = state.media?.path || "";
    const mediaChanged = mediaPath !== (previous.media?.path || "");
    const generationSource = selection.generationSource || "audio";
    const generationMode = selection.generationMode || "bilingual";
    const existing = generationSource === "existing-subtitle";
    const trackId =
      mediaChanged ||
      String(previous.selectedTrackId) !== String(state.selectedTrackId) ||
      selection.trackId == null
        ? state.selectedTrackId
        : selection.trackId;
    const languagesChanged =
      mediaChanged ||
      previous.sourceLanguage !== state.sourceLanguage ||
      previous.targetLanguage !== state.targetLanguage;
    let sourceLanguage =
      (languagesChanged ? state.sourceLanguage : selection.sourceLanguage) ||
      "";
    const targetLanguage =
      (languagesChanged ? state.targetLanguage : selection.targetLanguage) ||
      "";
    const tracks = Array.isArray(state.tracks) ? state.tracks : [];
    const allSubtitles = Array.isArray(state.availableSubtitles)
      ? state.availableSubtitles
      : [];
    const subtitles = existing
      ? allSubtitles
      : allSubtitles.filter(
          (subtitle) =>
            !subtitle.sourceLanguage ||
            !subtitle.targetLanguage ||
            (subtitle.sourceLanguage === sourceLanguage &&
              subtitle.targetLanguage === targetLanguage),
        );
    let subtitlePath = mediaChanged ? "" : selection.subtitlePath || "";
    if (
      (mediaChanged ||
        previous.selectedSubtitlePath !== state.selectedSubtitlePath) &&
      subtitles.some((subtitle) => subtitle.path === state.selectedSubtitlePath)
    )
      subtitlePath = state.selectedSubtitlePath;
    if (!subtitles.some((subtitle) => subtitle.path === subtitlePath))
      subtitlePath = subtitles[0]?.path || "";
    const subtitle = subtitles.find(
      (subtitle) => subtitle.path === subtitlePath,
    );
    if (existing && subtitle?.sourceLanguage)
      sourceLanguage = subtitle.sourceLanguage;
    const needsTarget = existing || generationMode !== "source";
    const sameLanguage = Boolean(
      needsTarget && sourceLanguage && sourceLanguage === targetLanguage,
    );
    const sourceError = !sourceLanguage
      ? "请选择源语言。"
      : sameLanguage
        ? "源语言和目标语言不能相同。"
        : "";
    const targetError = !needsTarget
      ? ""
      : !targetLanguage
        ? "请选择目标语言。"
        : sameLanguage
          ? "请选择不同的转录语言和翻译语言。"
          : "";
    const capabilities = policy.operationCapabilities(state);
    const checkingSubtitles = Boolean(
      state.media && state.subtitleLibraryLoading,
    );
    const matchingSubtitle =
      !existing &&
      allSubtitles.some(
        (subtitle) =>
          subtitle.sourceLanguage === sourceLanguage &&
          subtitle.targetLanguage === targetLanguage,
      );
    const startLabel = existing
      ? "翻译并生成新版本"
      : matchingSubtitle
        ? "重新生成"
        : "生成字幕";
    const canGenerate = Boolean(
      state.media &&
      capabilities.generate &&
      !checkingSubtitles &&
      !sourceError &&
      !targetError &&
      (existing
        ? subtitle
        : tracks.some(
            (track) => track.available && String(track.id) === String(trackId),
          )),
    );
    const mode = existing ? "translate" : generationMode;
    const target = needsTarget ? targetLanguage : "";
    const valid = Boolean(state.media && !sourceError && !targetError);
    const check = [
      state.languagePreflight,
      ...(state.languagePreflight?.readyChecks || []),
    ].find(
      (check) =>
        check &&
        check.mediaPath === mediaPath &&
        check.sourceLanguage === sourceLanguage &&
        check.targetLanguage === target &&
        (check.generationMode || "bilingual") === mode,
    );
    return {
      mediaPath,
      mediaChanged,
      generationSource,
      generationMode,
      existing,
      trackId,
      tracks,
      sourceLanguage,
      targetLanguage,
      needsTarget,
      sourceError,
      targetError,
      subtitles,
      subtitle,
      subtitlePath,
      sourceOnly: subtitle?.mode === "source",
      capabilities,
      checkingSubtitles,
      canGenerate,
      startLabel,
      preflight: {
        valid,
        mode,
        key: valid
          ? JSON.stringify([mediaPath, sourceLanguage, target, mode])
          : "",
        check,
        request: {
          sourceLanguage,
          targetLanguage: target,
          generationMode: mode,
        },
      },
    };
  }
  const api = { deriveSidebarState };
  if (typeof module !== "undefined") module.exports = api;
  else root.sidebarState = api;
})(typeof window !== "undefined" ? window : globalThis);
