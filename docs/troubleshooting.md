# 排障指南

先看侧栏任务详情和当前阶段，再根据下面的边界定位。日志或截图中如包含媒体绝对路径，分享前请先脱敏。

## 快速检查

```bash
command -v ffmpeg
command -v ffprobe
ffmpeg -version
```

插件需要可执行的 FFmpeg；helper 会根据 FFmpeg 的 stream index 处理选中的音轨。IINA 中的外部字幕/外部音轨没有可用的 FFmpeg `ff-index`，不能作为输入。

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| IINA 报 `Duplicated plugin identifiers detected` | 同一个 `io.otoha.iina` 有多个安装包或开发链接 | 在 IINA Plugins 设置删除重复项；或用 `iina-plugin unlink <旧包目录>` 后只保留一个包，再重启 IINA |
| 侧栏提示找不到 helper | 开发包未重新打包、包内路径缺失或旧链接仍生效 | 重新运行 package 和 verify，再 unlink 旧链接并 link 新包 |
| 生成前提示未找到 FFmpeg | PATH 对 IINA 不可见，或路径不可执行 | 在终端确认 `command -v ffmpeg`；在 Otoha Preferences 填写 FFmpeg 的绝对路径 |
| 生成前提示音轨不可用 | 选中的是外部音轨，或没有有效 `ff-index` | 换用视频容器内的音轨；确认当前文件是本地文件 |
| `所选音轨中没有识别到语音` | 音轨没有语音、音量过低或语言选择错误 | 检查音轨和源语言；选择确实含有人声的音轨后重新生成 |
| `speech.unsupportedLanguage` | 当前 macOS/Apple Speech 不支持所选语言资源 | 换用设置中列出的语言；确认系统已完成资源准备 |
| `translation.failed` | Apple Translation 资源尚未准备好或翻译任务失败 | 完成 macOS 的系统提示，稍后重试；确认源语言和目标语言不同 |
| 字幕已生成但 IINA 加载失败 | ASS 已保存，但 IINA 没有在超时内确认外挂轨道 | 在播放器中检查字幕轨道；使用“重试加载”；必要时重启 IINA 后从“字幕列表”加载 |
| 有字幕但没有自动加载 | “自动加载”是关闭状态，或字幕库根目录已改变 | 打开自动加载；确认设置中的字幕库根目录与生成时一致 |
| 只显示一行 | 当前“显示”模式选择了原文或译文 | 把显示方式切换为“双语”；该选择按视频保存 |
| 生成后字幕顺序不对 | 使用了旧的显示缓存或旧版本 ASS | 从字幕列表重新加载；确认同一语言对重新生成已完成后再切换显示方式 |
| 语言选择没有沿用预期 | 每视频设置优先于全局默认 | 重新选择当前视频的源/目标语言并成功生成；新视频才使用全局默认 |
| 侧栏一直显示旧视频 | 媒体切换的旧异步操作尚未结束 | 等待取消完成后刷新侧栏；不要同时启动多个生成任务 |

## 输出位置和清理

默认输出位于：

```text
~/Library/Application Support/Otoha/Subtitles/
```

每个视频使用独立哈希目录。删除某个视频的字幕时，只删除对应目录中的 `.ass`；不要删除整个 Otoha 目录，除非希望清空所有视频的历史版本。设置自定义目录后，旧目录不会自动迁移。

## helper 协议错误

helper 每行向 stdout 输出一个 JSONL 事件，插件会校验 `protocolVersion`、`type`、`jobId`、阶段和错误码。遇到未知事件时插件会丢弃该行并保留当前任务状态。不要根据中文 `message` 判断程序分支；请使用 [稳定错误码表](runtime-state-and-protocol-v1.md#5-稳定错误码)。

## 仍需实机确认的情况

- 首次使用 Apple Speech/Translation 时的权限和资源下载提示。
- 不同容器、多音轨文件的 `ff-index` 映射。
- IINA 真实 `track-list` 的外挂字幕确认和超时行为。
- VoiceOver、深色模式、长文件名和窄侧栏下的最终可访问性表现。

这些项目不能仅通过 Node/Swift fixture 或包 verifier 证明。请把 macOS 版本、IINA 版本、媒体容器（不要上传媒体本身）、音轨信息、phase 和错误码一起记录。
