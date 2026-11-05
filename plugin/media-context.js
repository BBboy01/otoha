function createMediaContext(localMedia) {
  function mediaPathForURL(value) {
    try { return localMedia(value).path; } catch { return ""; }
  }

  function mediaSnapshot(url) {
    let media = null;
    let mediaError = "";
    if (url) {
      try { media = localMedia(url); } catch (error) { mediaError = error.message; }
    }
    return { media, mediaError };
  }

  return { mediaPathForURL, mediaSnapshot };
}

module.exports = { createMediaContext };
