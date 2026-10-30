# Otoha 运行时状态与 helper protocol v1

本文定义插件与随包 Swift helper 之间的稳定边界。它是 issue #2 的实现契约，后续模块化工作应先遵守这里的字段和状态语义，再扩展实现。

## 1. 状态快照

插件向侧栏发送一个完整的 `AppState` 快照。快照是可重放的视图输入，侧栏不保存任务真相，也不通过本地轮询推断任务状态。

```json
{
  "media": { "path": "/Videos/episode.mkv", "name": "episode.mkv" },
  "tracks": [{ "id": 7, "streamIndex": 2, "lang": "ja", "title": "Japanese", "available": true }],
  "subtitleLibrary": {
    "rootDirectoryPath": "/Users/me/Library/Application Support/Otoha/Subtitles",
    "files": [{ "path": "/.../episode [ja to zh-Hans].ass" }],
    "loading": false
  },
  "subtitle": { "selectedPath": "/.../episode [ja to zh-Hans].ass", "loaded": true },
  "job": {
    "jobId": "1760000000000-abcd",
    "status": "completed",
    "phase": "loading",
    "progress": 1,
    "path": "/.../episode [ja to zh-Hans].ass",
    "errorCode": null,
    "message": "双语字幕已加载"
  },
  "settings": {
    "autoLoad": true,
    "sourceLanguage": "ja",
    "targetLanguage": "zh-Hans",
    "displayMode": "bilingual"
  },
  "ui": { "sidebarLoaded": true, "canGenerate": true, "canCancel": false }
}
```

### 状态枚举

`job.status` 使用 `idle`、`checking`、`running`、`canceling`、`loading`、`completed`、`cancelled`、`error`。当前侧栏为保留“重试加载”动作仍会把 `subtitle.loadFailed` 映射为 `load-error` 展示状态；后续状态 store 会统一为 `error + errorCode`。`job.phase` 使用 `checkingEnvironment`、`preparingLanguageResources`、`extractingAudio`、`transcribing`、`translating`、`saving`、`loading`。

播放媒体、字幕库、任务和偏好设置属于插件运行时真相；侧栏只负责渲染和发送用户意图。`settings` 中的全局偏好来自 IINA preference，语言和显示方式的每视频记忆由插件按媒体路径保存。helper 只拥有当前任务的处理状态，不修改插件偏好或字幕选中状态。

每次媒体切换、字幕查找、字幕加载和转录任务都生成单调递增的 operation token。异步结果只有在 token、媒体路径和 `jobId` 同时仍匹配时才能提交到状态；过期结果必须丢弃。

## 2. 请求 JSON

插件通过 `--request-json` 传入一个 JSON 对象：

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| `protocolVersion` | `1` | 必须为数字 1 |
| `jobId` | string | 插件生成的非空任务 ID，事件原样回传 |
| `backend` | string | 当前为 `apple` |
| `mediaPath` | string | 本地绝对路径 |
| `ffmpegPath` | string | 可执行 FFmpeg 的绝对路径或 PATH 解析结果 |
| `audioStreamIndex` | integer | FFmpeg 全局音频 stream index |
| `sourceLanguage` / `targetLanguage` | string | 不同的 BCP-47 风格语言标识 |
| `subtitleScale` | number | 0.8 到 1.4 |
| `outputDirectoryPath` | string? | 空值表示 `~/Library/Application Support/Otoha/Subtitles` |
| `cancellationFilePath` | string | 当前任务的取消标记文件 |

helper 必须拒绝缺少 `protocolVersion` 或 `jobId` 的任务。请求解析失败也要输出一个 v1 `error` 事件；无法读取任务 ID 时使用 `unknown`，以便插件仍能显示可操作的错误。

## 3. JSONL 事件

helper 只向 stdout 写 JSONL，每行一个对象；日志写 stderr。所有事件包含 `protocolVersion: 1`、`type` 和非空 `jobId`。

```json
{"protocolVersion":1,"type":"phase","jobId":"...","phase":"transcribing","progress":0.4,"message":"正在转录"}
{"protocolVersion":1,"type":"completed","jobId":"...","path":"/Users/me/Library/Application Support/Otoha/Subtitles/episode [ja to zh-Hans].ass"}
{"protocolVersion":1,"type":"cancelled","jobId":"..."}
{"protocolVersion":1,"type":"error","jobId":"...","code":"speech.noSpeech","message":"所选音轨中没有识别到语音。"}
```

事件类型和字段约束如下：

| type | 必填字段 | 语义 |
| --- | --- | --- |
| `phase` | `phase` | 阶段发生；`progress` 可省略，存在时必须为 0 到 1 |
| `completed` | `path` | ASS 已可靠写入；插件随后负责加载 |
| `cancelled` | 无 | 任务响应取消，不发布半成品 |
| `error` | `code`, `message` | 稳定错误码用于逻辑分支，message 只用于展示 |

插件遇到未知版本、事件类型、阶段或错误码时丢弃该行并保留当前任务状态。不能用中文 message 作为程序分支条件。

## 4. 稳定错误码

| code | 适用情况 |
| --- | --- |
| `helper.invalidRequest` | 请求 JSON 缺失或字段无效 |
| `helper.unsupportedSystem` | 当前 macOS 不满足 Apple API 要求 |
| `helper.unknown` | 未分类的 helper 错误 |
| `ffmpeg.notFound` | FFmpeg/FFprobe 不存在或不可执行 |
| `ffmpeg.invalidAudioStream` | 音频 stream index 无效 |
| `ffmpeg.extractionFailed` | 音轨提取失败 |
| `speech.unsupportedLanguage` | 本机不支持所选转录语言 |
| `speech.noAudio` / `speech.noSpeech` | 没有音频或没有识别到语音 |
| `speech.missingFormat` | 没有可用的 SpeechAnalyzer 音频格式 |
| `translation.failed` | Apple 翻译任务失败 |
| `subtitle.incompleteTranslation` | 翻译结果数量不完整 |
| `subtitle.publishFailed` | ASS 写入或替换失败 |
| `subtitle.libraryFailed` | 字幕列表读取失败 |
| `subtitle.loadFailed` | IINA 未确认外挂字幕轨道加载 |
| `job.cancelled` | 用户或媒体切换取消任务 |

## 5. 兼容与演进

v1 只允许向对象增加可选字段。改变字段含义、事件状态机或错误码时递增 `protocolVersion`，并在插件和 helper 同一个 PR 中更新 Node/Swift 契约测试。旧事件不做隐式兼容，避免把失真的进度或错误当成成功。
