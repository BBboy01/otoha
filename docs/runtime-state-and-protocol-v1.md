# Otoha 运行时状态与 helper protocol v1

本文定义插件与随包 Swift helper 之间的稳定边界。它是 protocol v1 的实现契约；修改字段、阶段或错误码时，必须同步更新 JavaScript 校验、Swift 事件和测试。架构背景见 [architecture.md](architecture.md)。

## 1. 状态快照

插件向侧栏发送一个完整的 `AppState` 快照。快照是可重放的视图输入，侧栏不保存任务真相，也不通过本地轮询推断任务状态。

```json
{
  "title": "episode.mkv",
  "media": { "path": "/Videos/episode.mkv", "name": "episode.mkv" },
  "mediaError": "",
  "tracks": [{ "id": 7, "streamIndex": 2, "lang": "ja", "title": "Japanese", "available": true }],
  "selectedTrackId": 7,
  "sourceLanguage": "ja",
  "targetLanguage": "zh-Hans",
  "selectedSubtitlePath": "/.../episode [ja to zh-Hans].ass",
  "displayMode": "bilingual",
  "autoLoad": true,
  "outputDirectory": "",
  "effectiveOutputDirectory": "/Users/me/Library/Application Support/Otoha/Subtitles",
  "availableSubtitles": [{ "path": "/.../episode [ja to zh-Hans].ass", "sourceLanguage": "ja", "targetLanguage": "zh-Hans" }],
  "subtitleLibraryLoading": false,
  "editorOpen": false,
  "ffmpegPath": "/opt/homebrew/bin/ffmpeg",
  "job": {
    "jobId": "1760000000000-abcd",
    "status": "completed",
    "phase": "loading",
    "progress": 1,
    "path": "/.../episode [ja to zh-Hans].ass",
    "errorCode": null,
    "message": "双语字幕已加载"
  },
  "hasOutput": true
}
```

### 任务状态与阶段

| `job.status` | 含义 |
| --- | --- |
| `idle` | 没有活动任务 |
| `running` | helper 正在生成字幕，细节由 `job.phase` 表示 |
| `canceling` | 正在等待取消完成 |
| `loading` | 插件正在请求 IINA 加载字幕 |
| `completed` | 字幕已加载 |
| `cancelled` | 任务已取消 |
| `available` | 字幕库中有字幕，尚未加载 |
| `error` | 生成任务失败 |
| `load-error` | IINA 未确认字幕加载；侧栏保留“重试加载”操作 |
| `checking` | 侧栏在字幕库查询期间合成的临时展示状态，不是 helper 状态 |

`job.phase` 表示当前处理步骤：

| 阶段 | 含义 |
| --- | --- |
| `checkingEnvironment` | 检查 FFmpeg 和输入文件 |
| `preparingLanguageResources` | 准备 Apple Speech/Translation 资源 |
| `extractingAudio` | 从选定音轨提取音频 |
| `transcribing` | 识别源语言并生成带时间戳的文本 |
| `translating` | 翻译识别结果 |
| `saving` | 写入 ASS 字幕文件 |
| `loading` | 插件请求 IINA 加载字幕 |

播放媒体、字幕库、任务和偏好设置属于插件运行时真相；侧栏只负责渲染和发送用户意图。上面的平面字段是当前 `sendState` 的传输形状，后续 state store 可以在内部规范化，但不能改变字段语义。全局偏好来自 IINA preference，语言和显示方式的每视频记忆由插件按媒体路径保存。helper 只拥有当前任务的处理状态，不修改插件偏好或字幕选中状态。

异步结果只有在对应操作、当前媒体路径和 `jobId` 仍匹配时才能提交到状态；过期结果必须丢弃。具体并发控制方式属于插件实现，见[架构说明](architecture.md#异步任务与取消)。

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
| `subtitleScale` | number | 0.5 到 3.0 |
| `subtitleFont` | string | 可选，默认 Arial；1 到 128 个字符，不含逗号或控制字符，应用于 ASS 样式与换行测量 |
| `subtitleStyle` | object | 可选，`font`、`scale`、`color`（#RRGGBB）、`background`、`dimSource`；优先用于最终 ASS 样式 |
| `videoWidth` / `videoHeight` | integer? | IINA 当前视频尺寸，用宽高比计算 ASS 逻辑画布与可用文字宽度；缺失或无效时使用 1920×1080 基准，同一比例不因像素分辨率改变排版 |
| `outputDirectoryPath` | string? | 空值表示 `~/Library/Application Support/Otoha/Subtitles` |
| `cancellationFilePath` | string | 当前任务的取消标记文件 |

helper 必须拒绝缺少 `protocolVersion` 或 `jobId` 的任务。请求解析失败也要输出一个 v1 `error` 事件；无法读取任务 ID 时使用 `unknown`，以便插件仍能显示可操作的错误。

## 3. JSONL 事件

helper 只向 stdout 写 JSONL，每行一个对象；日志写 stderr。所有事件包含 `protocolVersion: 1`、`type` 和非空 `jobId`。

```json
{"protocolVersion":1,"type":"phase","jobId":"...","phase":"transcribing","message":"正在转录"}
{"protocolVersion":1,"type":"phase","jobId":"...","phase":"translating","progress":0.4,"message":"正在翻译"}
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

没有可测量进度时省略 `progress`，侧栏显示不确定进度；不以阶段序号或已耗时推算百分比。当前 Speech 转录不提供可靠媒体进度；语音模型下载和 Translation 批次结果可提供实测百分比。每次阶段事件都替换旧 `progress`，避免翻译百分比残留到保存阶段。

插件从占用任务槽时记录 `job.startedAt`（毫秒时间戳），跨阶段及侧栏重载保留。取消请求或终态记录 `job.finishedAt`，侧栏用二者展示总耗时，每秒仅更新耗时文本，不反复播报 `role=status`。这两个字段由插件维护，不属于 helper JSONL，也不代表 helper 心跳。运行中显示阶段和取消按钮；加载期间显示不确定进度；取消期间停止进度及耗时，忽略迟到的阶段事件。失败详情、加载重试和媒体切换恢复沿用现有状态机。

## 4. helper 启动与首次运行

正常任务不创建或前置原生窗口。helper 以后台模式启动，所有进度、取消、完成和错误通过上述 JSONL 事件回到 IINA 侧栏。只有显式传入 `--ui` 的调试启动才创建 Otoha 原生窗口；该入口不属于插件正常任务协议。

首次使用 Apple Speech 或 Translation 时，macOS 可能要求授予语音识别权限、下载语言模型或准备翻译资源。这些系统级提示由 macOS 管理，后台 helper 不能保证将它们静默化；出现提示时，用户应完成系统提示后等待当前任务继续。资源准备完成后，后续任务复用本机资源，不应重复打开 Otoha 窗口。

字幕列表查询使用同一个 helper 的 `--list-subtitles-json` 参数，输入 `{ "mediaPath": "...", "outputDirectoryPath": "..." }`，输出 `{ "rootDirectoryPath": "...", "files": [{ "path": "..." }] }`。列表查询不会启动语音或翻译任务，也不会修改字幕文件。

## 5. 语言预检（#26）

`--check-languages-json` 在后台执行只读能力检查，不接收媒体/输出路径，不提取音频、不下载模型、不写字幕。输入示例：

```json
{"protocolVersion":1,"requestId":"language-1","sourceLanguage":"en","targetLanguage":"ja"}
```

stdout 返回一行 JSON，包含相同的版本、requestId 和语言对，以及 `speech` / `translation` 状态（`installed`、`supported`、`downloading`、`unsupported`）、用户文案 `message`，不可用时包含 `errorCode`。非法请求或系统错误退出非零，原因写 stderr。能力查询最多等待 30 秒，超时可重试。

侧栏状态通过 `languagePreflight` 投影，包含 `mediaPath`、语言对及 `idle/checking/ready/unavailable/error`。只有当前媒体和语言对匹配的 `ready` 可以生成；请求序号隔离迟到结果，切换语言或媒体后旧结果不能启用生成按钮。预检失败保留语言选择及重新检查操作，不影响已有字幕播放。生成入口仍重新执行 helper 能力检查，防止缓存过期或绕过 UI。

Speech 的 `supported/downloading` 可继续，在生成时通过原有可取消资源准备流程处理。后台 Translation 使用 `installedSource`，仅 `installed` 可继续；`supported` 明确提示先通过 macOS 翻译功能下载语言后重试，不宣称后台 helper 可以弹出下载授权。高保真策略与实际翻译会话一致，不自动识别源语言。

新增错误码：`translation.unsupportedLanguage`（语言对不支持）、`translation.resourcesMissing`（资源未安装），Speech 不支持继续使用 `speech.unsupportedLanguage`。预检失败或取消发生在音轨提取和输出目录创建前，不覆盖已有 ASS。

详见 Apple [LanguageAvailability](https://developer.apple.com/documentation/translation/languageavailability) 和 [installedSource 会话](https://developer.apple.com/documentation/translation/translationsession/init(installedsource:target:preferredstrategy:)) 的下载边界。

## 6. SRT 导出（#27）
SRT 导出通过 `--export-srt-json` 调用 helper，输入协议版本、当前视频路径、已选 ASS 路径、字幕库根目录、`destinationDirectoryPath` 和 `source` / `translation` / `bilingual` 模式，成功时输出 `{ "path": "...srt" }`。插件将目标目录设为字幕库根目录下的 `Exports`；helper 仅自动创建这个约定子目录，其他显式目标目录必须已存在，拒绝目标目录本身为符号链接。helper 只读取当前视频的 Otoha 字幕库内 ASS，并创建不覆盖已有文件的 SRT；连续导出会加 `(2)`、`(3)` 后缀。导出失败通过 stderr 和非零退出码返回，不更改原 ASS。媒体切换后不会向新视频侧栏发布旧导出的成功或失败反馈。

## 7. 稳定错误码

`helper.*`、`ffmpeg.*`、`speech.*` 和 `translation.*` 由 Swift helper 产生；`subtitle.libraryFailed` 与 `subtitle.loadFailed` 由插件在字幕库/IINA 加载边界产生，但共用同一 registry 和展示语义。

字幕库删除使用单次 JSON 参数 `--delete-subtitle-json`，字段为 `protocolVersion`、`requestId`、`mediaPath`、`subtitlePath` 和可选的 `outputDirectoryPath`。helper 按当前媒体计算字幕库目录，只允许删除目录内符合该媒体命名规则的普通 ASS 文件；成功响应返回同版本、请求 ID 和删除路径。拒绝响应包含稳定错误码和下一步提示：`subtitle.deleteOutsideLibrary`、`subtitle.deleteMissing` 或 `subtitle.deleteFailed`。插件仅在匹配请求 ID 与路径后更新选择、播放器轨道和列表。

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
| `translation.unsupportedLanguage` | 本机不支持所选翻译语言对 |
| `translation.resourcesMissing` | 后台翻译所需的语言资源尚未安装 |
| `subtitle.incompleteTranslation` | 翻译结果数量不完整 |
| `subtitle.publishFailed` | ASS 写入或替换失败 |
| `subtitle.libraryFailed` | 字幕列表读取失败 |
| `subtitle.loadFailed` | IINA 未确认外挂字幕轨道加载 |
| `subtitle.editUnsupported` | 不是可校对的 Otoha 双语 ASS，包含内联样式或不支持的格式 |
| `subtitle.editInvalidText` | 缺少原文/译文、片段数量不匹配或文本含 NUL |
| `subtitle.editOutsideLibrary` | 目标不在当前视频字幕库、是符号链接，或编辑期间切换了视频/字幕库 |
| `subtitle.editConflict` | 外部修改使文件 SHA-256 与读取版本不符 |
| `subtitle.editTooLarge` | 原文件/保存结果超过 16 MiB，或请求超过 32 MiB |
| `job.cancelled` | 用户或媒体切换取消任务 |

## 8. 兼容与演进

v1 可增加可选字段、独立命令和 registry 条目。改变已有字段、事件状态机或错误码的含义时递增 `protocolVersion`，并在插件和 helper 同一个 PR 中更新 Node/Swift 契约测试。旧事件不做隐式兼容，避免把失真的进度或错误当成成功。

## 9. 字幕校对

校对是独立的后台命令，不启动 FFmpeg、Speech、Translation 或原生窗口。`--read-subtitle-json <JSON>` 读取当前视频字幕库中的 canonical ASS；`--save-subtitle-file <绝对路径>` 读取 `otoha-edit-*.json` 保存请求，避免长字幕超过进程参数上限或出现在 IINA 的参数日志中。插件在 `@tmp` 写请求，并在 helper 返回后删除；进程异常退出遗留的文件由 IINA 临时目录生命周期管理。

两个命令的请求均含 `protocolVersion: 1`、非空 `requestId`、绝对路径 `mediaPath` / `subtitlePath` 和可选 `outputDirectoryPath`。保存还要求读取时的 `revision`（原文件 SHA-256）与按读取顺序排列的 `texts: [{source, translation}]`。请求不得增删 cue 或更改时间。读取限制 16 MiB，请求限制 32 MiB。

每次输出一行 `{protocolVersion, requestId, snapshot}`，其中 `snapshot` 为 `{path, revision, cues: [{start, end, source, translation}]}`，时间单位为秒。失败输出 `{protocolVersion, requestId, code, message}`，使用上述 registry；业务错误不会作为成功快照提交。未知版本、错误码、请求 ID 或无效片段均拒绝。

解析器保留头部、样式、事件顺序、时间、非文本字段和 LF/CRLF；相同时间的重复 cue 按出现顺序配对，只有 `OtohaSource` / `OtohaTranslation` 文本可修改。内联 ASS override 等无法安全还原的文本会拒绝编辑。修改的文本复用字体测量换行，遵循原画布、字体、水平缩放和边距；未修改文本逐字保留。

保存会再次确认目标属于该视频字幕库且不经过符号链接，并在同目录创建独占临时文件、写入/fsync、再次检查版本后 rename 替换。保存失败清理临时文件，旧 ASS 保持完整。版本检查是乐观并发保护，不是跨进程文件锁。

`editor` 消息按 `sessionId` 发送 `loading / ready / saving / saved / error / closed` 快照。未保存草稿仅在侧栏本地；关闭需要确认，保存中不允许退出。切换视频后保留草稿并禁用保存/定位，回到原视频后可继续；helper 结束时仍校验当前上下文。保存后刷新字幕列表，在原文/译文模式重建显示缓存，已存在轨道调用一次 `sub-reload`，否则加载一次；IINA 加载失败保留已保存 ASS 和重试入口。校对不修改每视频语言/显示方式记忆。
