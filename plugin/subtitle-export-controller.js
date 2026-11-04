const PROTOCOL_VERSION = 1;
const MODES = new Set(["source", "translation", "bilingual"]);

function absolute(value) {
  return typeof value === "string" && value.startsWith("/") && !value.includes("\0")
    && !value.split("/").some((part) => part === "." || part === "..");
}

function normalized(value) {
  return `/${value.split("/").filter(Boolean).join("/")}`;
}

function createSubtitleExportController({ chooseDirectory, exec, getContext, onResult }) {
  let exporting = false;

  function report(result) {
    if (typeof onResult === "function") onResult(result);
  }

  function validContext(context, subtitlePath) {
    return context
      && absolute(context.helperPath)
      && absolute(context.mediaPath)
      && absolute(context.libraryRootPath)
      && Array.isArray(context.subtitles)
      && context.subtitles.some((subtitle) => subtitle && subtitle.path === subtitlePath);
  }

  async function exportSubtitle({ subtitlePath, mode } = {}) {
    if (exporting) return;
    let initial;
    try {
      initial = getContext();
      if (!MODES.has(mode) || !validContext(initial, subtitlePath)) {
        throw new Error("请选择当前视频字幕列表中的 ASS 文件和导出内容。");
      }
      exporting = true;
      report({ status: "running" });
      const destinationDirectoryPath = await chooseDirectory("选择 SRT 导出文件夹", { chooseDir: true });
      if (!destinationDirectoryPath) {
        report({ status: "cancelled" });
        return;
      }
      if (!absolute(destinationDirectoryPath)) throw new Error("请选择一个有效的本地导出文件夹。");
      const current = getContext();
      if (!validContext(current, subtitlePath)
        || current.mediaPath !== initial.mediaPath
        || current.libraryRootPath !== initial.libraryRootPath) {
        throw new Error("选择目录期间视频或字幕列表已变化，请重新选择字幕后导出。");
      }

      const request = {
        protocolVersion: PROTOCOL_VERSION,
        mediaPath: current.mediaPath,
        subtitlePath,
        libraryRootPath: current.libraryRootPath,
        destinationDirectoryPath,
        mode,
      };
      const result = await exec(current.helperPath, ["--export-srt-json", JSON.stringify(request)]);
      if (!result || result.status !== 0) {
        throw new Error(String(result && result.stderr || "helper 无法写入 SRT，请检查导出目录权限。").trim());
      }
      let response;
      try {
        response = JSON.parse(String(result.stdout || "{}"));
      } catch {
        throw new Error("helper 返回了无效的 SRT 导出结果，请重试。");
      }
      const outputPath = response && response.path;
      if (!absolute(outputPath) || !outputPath.toLowerCase().endsWith(".srt")
        || normalized(outputPath.slice(0, outputPath.lastIndexOf("/"))) !== normalized(destinationDirectoryPath)) {
        throw new Error("SRT 导出结果不在所选文件夹中，请检查 helper 版本后重试。");
      }
      report({ status: "success", path: outputPath });
    } catch (error) {
      report({ status: "error", message: error && error.message ? error.message : String(error) });
    } finally {
      exporting = false;
    }
  }

  return { export: exportSubtitle };
}

function createSubtitleExportRuntime({ utils, getContext, onResult }) {
  return createSubtitleExportController({
    chooseDirectory: (...args) => utils.chooseFile(...args),
    exec: (...args) => utils.exec(...args),
    getContext,
    onResult,
  });
}

module.exports = { createSubtitleExportController, createSubtitleExportRuntime };
