const DISPLAY_MODES = new Set(["source", "translation", "bilingual"]);

class SubtitleDisplayError extends Error {}

function normalizeDisplayMode(value) {
  return DISPLAY_MODES.has(value) ? value : "bilingual";
}

function renderSubtitleMode(content, mode) {
  if (typeof content !== "string") throw new SubtitleDisplayError("字幕内容无效。");
  const normalizedMode = normalizeDisplayMode(mode);
  if (normalizedMode === "bilingual") return content;

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const styles = findSection(lines, ["v4+ styles", "v4 styles"]);
  const events = findSection(lines, ["events"]);
  if (!styles || !events) throw new SubtitleDisplayError("字幕缺少 ASS 样式或事件区段。");

  const styleFormat = findFormat(lines, styles.start, styles.end);
  const eventFormat = findFormat(lines, events.start, events.end);
  if (!styleFormat || !eventFormat) throw new SubtitleDisplayError("字幕缺少 ASS 字段定义。");

  const styleNameIndex = fieldIndex(styleFormat.fields, "name");
  const eventStyleIndex = fieldIndex(eventFormat.fields, "style");
  const eventTextIndex = fieldIndex(eventFormat.fields, "text");
  if (styleNameIndex < 0 || eventStyleIndex < 0 || eventTextIndex < 0) {
    throw new SubtitleDisplayError("字幕缺少 ASS 样式或文本字段。");
  }

  const selectedStyle = normalizedMode === "source" ? "OtohaSource" : "OtohaTranslation";
  const translationStyle = findStyle(lines, styles.start, styles.end, "OtohaTranslation", styleNameIndex);
  if (normalizedMode === "source" && !findStyle(lines, styles.start, styles.end, "OtohaSource", styleNameIndex)) {
    throw new SubtitleDisplayError("字幕缺少原文样式。");
  }
  if (!translationStyle) throw new SubtitleDisplayError("字幕缺少译文样式。");

  const outputLines = lines.slice();
  const singleStyle = cloneStyle(translationStyle.line, styleNameIndex, "OtohaSingle");
  const existingSingleStyle = findStyle(lines, styles.start, styles.end, "OtohaSingle", styleNameIndex);
  if (existingSingleStyle) outputLines[existingSingleStyle.index] = singleStyle;
  else outputLines.splice(translationStyle.index + 1, 0, singleStyle);

  let selectedEvents = 0;
  const eventStart = events.start + (existingSingleStyle ? 0 : 1);
  const eventEnd = events.end + (existingSingleStyle ? 0 : 1);
  for (let index = eventStart; index < eventEnd; index += 1) {
    const line = outputLines[index];
    if (!/^\s*Dialogue\s*:/i.test(line)) continue;
    const body = line.slice(line.indexOf(":") + 1);
    const fields = splitFields(body, eventFormat.fields.length);
    if (!fields) throw new SubtitleDisplayError("字幕事件字段无效。");
    const eventStyle = fields[eventStyleIndex].trim();
    if (eventStyle !== selectedStyle) {
      outputLines[index] = null;
      continue;
    }
    if (!fields[eventTextIndex].trim()) throw new SubtitleDisplayError("字幕缺少选定语言文本。");
    fields[eventStyleIndex] = fields[eventStyleIndex].replace(eventStyle, "OtohaSingle");
    outputLines[index] = `${line.slice(0, line.indexOf(":") + 1)}${fields.join(",")}`;
    selectedEvents += 1;
  }

  if (selectedEvents === 0) throw new SubtitleDisplayError("字幕缺少选定语言事件。");
  return outputLines.filter((line) => line !== null).join(newline);
}

function findSection(lines, names) {
  const allowed = new Set(names);
  const start = lines.findIndex((line) => {
    const match = line.trim().match(/^\[([^\]]+)\]$/);
    return match && allowed.has(match[1].toLowerCase());
  });
  if (start < 0) return null;
  const next = lines.findIndex((line, index) => index > start && /^\s*\[[^\]]+\]\s*$/.test(line));
  return { start, end: next < 0 ? lines.length : next };
}

function findFormat(lines, start, end) {
  for (let index = start; index < end; index += 1) {
    const match = lines[index].match(/^\s*Format\s*:\s*(.*)$/i);
    if (match) return { index, fields: match[1].split(",").map((field) => field.trim().toLowerCase()) };
  }
  return null;
}

function fieldIndex(fields, name) {
  return fields.findIndex((field) => field === name);
}

function findStyle(lines, start, end, name, nameIndex) {
  for (let index = start; index < end; index += 1) {
    if (!/^\s*Style\s*:/i.test(lines[index])) continue;
    const fields = lines[index].slice(lines[index].indexOf(":") + 1).split(",");
    if (fields[nameIndex] && fields[nameIndex].trim() === name) return { index, line: lines[index] };
  }
  return null;
}

function cloneStyle(line, nameIndex, name) {
  const colon = line.indexOf(":");
  const fields = line.slice(colon + 1).split(",");
  fields[nameIndex] = fields[nameIndex].replace(fields[nameIndex].trim(), name);
  return `${line.slice(0, colon + 1)}${fields.join(",")}`;
}

function splitFields(body, count) {
  const fields = [];
  let offset = 0;
  for (let index = 0; index < count - 1; index += 1) {
    const comma = body.indexOf(",", offset);
    if (comma < 0) return null;
    fields.push(body.slice(offset, comma));
    offset = comma + 1;
  }
  fields.push(body.slice(offset));
  return fields;
}

module.exports = { SubtitleDisplayError, normalizeDisplayMode, renderSubtitleMode };
