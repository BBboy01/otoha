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
| `subtitleScale` | number | 0.8 到 1.4 |
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

## 6. 稳定错误码

`helper.*`、`ffmpeg.*`、`speech.*` 和 `translation.*` 由 Swift helper 产生；`subtitle.libraryFailed` 与 `subtitle.loadFailed` 由插件在字幕库/IINA 加载边界产生，但共用同一 registry 和展示语义。

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
| `job.cancelled` | 用户或媒体切换取消任务 |

## 7. 兼容与演进

v1 保持现有字段、事件状态机和错误码语义不变。新增只读命令及错误码 registry 必须随插件/helper 同包更新，并同步 Node/Swift 契约测试；改变已有字段含义、事件状态机或错误码含义时递增 `protocolVersion`。旧插件不会隐式接受未知错误码，避免把未理解的错误当成成功。
