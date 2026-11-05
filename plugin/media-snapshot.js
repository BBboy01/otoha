function mediaPathForURL(value, localMedia) {
  try { return localMedia(value).path; }
  catch { return ""; }
}

function mediaSnapshot(url, localMedia) {
  let media = null;
  let mediaError = "";
  if (url) {
    try {
      media = localMedia(url);
    } catch (error) {
      mediaError = error.message;
    }
  }
  return { media, mediaError };
}
function playerWindowIsLoaded(core) { return !core.window || core.window.loaded === true; }
module.exports = { mediaPathForURL, mediaSnapshot, playerWindowIsLoaded };
