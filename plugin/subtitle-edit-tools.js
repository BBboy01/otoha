(function (root) {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const fields = (scope) =>
    scope === "both" ? ["source", "translation"] : [scope];
  function search(cues, query, scope = "both") {
    const matches = [];
    if (!query) return matches;
    cues.forEach((cue, index) =>
      fields(scope).forEach((field) => {
        const value = cue[field] || "";
        for (
          let at = value.indexOf(query);
          at >= 0;
          at = value.indexOf(query, at + query.length)
        )
          matches.push({ index, field, at });
      }),
    );
    return matches;
  }
  function replace(
    cues,
    query,
    replacement,
    scope,
    all = false,
    selectedIndex = null,
  ) {
    const result = copy(cues);
    const matches = search(result, query, scope).filter(
      (match) =>
        selectedIndex === null ||
        (typeof selectedIndex === "object"
          ? match.index === selectedIndex.index &&
            match.field === selectedIndex.field &&
            match.at === selectedIndex.at
          : match.index === selectedIndex),
    );
    for (const match of (all ? matches : matches.slice(0, 1)).reverse()) {
      const value = result[match.index][match.field];
      result[match.index][match.field] =
        value.slice(0, match.at) +
        replacement +
        value.slice(match.at + query.length);
    }
    return result;
  }
  function merge(cues, index) {
    if (!cues[index] || !cues[index + 1])
      throw new Error("没有可合并的下一句。");
    const result = copy(cues),
      a = result[index],
      b = result[index + 1];
    result.splice(index, 2, {
      ...a,
      id: `new-${Date.now()}-${Math.random()}`,
      origins: [...new Set([...a.origins, ...b.origins])],
      start: Math.min(a.start, b.start),
      end: Math.max(a.end, b.end),
      source: a.source + "\n" + b.source,
      translation: a.translation ? a.translation + "\n" + b.translation : "",
    });
    return result;
  }
  function split(cues, index, sourceAt, translationAt, time) {
    const result = copy(cues),
      cue = result[index];
    const source = Array.from(cue?.source || ""),
      translation = Array.from(cue?.translation || "");
    if (
      !cue ||
      !Number.isFinite(time) ||
      !Number.isInteger(sourceAt) ||
      !(time > cue.start && time < cue.end) ||
      sourceAt <= 0 ||
      sourceAt >= source.length ||
      (cue.translation &&
        (!Number.isInteger(translationAt) ||
          translationAt <= 0 ||
          translationAt >= translation.length))
    )
      throw new Error("请选择句内时间和两种文本的切分位置。");
    result.splice(
      index,
      1,
      {
        ...cue,
        id: `left-${Date.now()}`,
        end: time,
        source: source.slice(0, sourceAt).join(""),
        translation: translation.slice(0, translationAt).join(""),
      },
      {
        ...cue,
        id: `right-${Date.now()}`,
        start: time,
        source: source.slice(sourceAt).join(""),
        translation: translation.slice(translationAt).join(""),
      },
    );
    return result;
  }
  function createLoop({ getPlayback, seek }) {
    let cue = null;
    return {
      set(value) {
        cue = value;
      },
      stop() {
        cue = null;
      },
      tick() {
        if (!cue) return;
        const state = getPlayback();
        if (!state || state.paused || !Number.isFinite(state.position)) return;
        const start = Math.max(0, cue.start - 0.3),
          end = Math.min(
            Number.isFinite(state.duration) ? state.duration : Infinity,
            cue.end + 0.3,
          );
        if (end <= start) return;
        if (state.position >= end || state.position < start) seek(start);
      },
    };
  }
  const api = { search, replace, merge, split, createLoop };
  if (typeof module !== "undefined") module.exports = api;
  else root.subtitleEditTools = api;
})(typeof window !== "undefined" ? window : globalThis);
