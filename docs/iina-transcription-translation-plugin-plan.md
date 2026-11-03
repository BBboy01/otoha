# Otoha 产品与技术决策

本文记录 Otoha 当前的产品目标、V1 范围和已确认决策。组件实现见[架构说明](architecture.md)，插件与 helper 的字段契约见[运行时状态与 protocol v1](runtime-state-and-protocol-v1.md)。

## 用户目标

用户在观看没有字幕的非母语视频时，可以在 IINA 侧栏选择音轨、明确源语言和目标语言，按一次“生成”，等待后台任务生成双语 ASS 并自动加载。用户也可以只显示原文、只显示译文或显示双语对照。

```mermaid
flowchart TD
    A[打开本地视频] --> B{字幕库有 ASS 且自动加载开启?}
    B -- 是 --> C[选择记忆的字幕并自动加载]
    B -- 否 --> D[侧栏选择音轨与语言]
    D --> E[点击“生成”]
    E --> F[后台转录与翻译]
    F --> G[保存 ASS]
    G --> H[加载并确认 IINA 字幕轨道]
    H --> I[选择原文 / 译文 / 双语]
```

## 已确认决策

| 主题 | 决策 | 原因 |
| --- | --- | --- |
| 后端 | 首版使用 Apple Speech + Translation；请求保留 backend 扩展点 | 使用系统框架，不维护自有语言模型服务 |
| helper | Swift helper 放在插件包内，用户只安装一次 | 不增加额外安装器和版本管理负担 |
| FFmpeg | 用户自行安装，插件从 PATH 查找，也允许配置绝对路径 | 让其他本机程序复用同一 FFmpeg |
| 触发方式 | 手动点击“生成”，后台执行 | 避免打开视频就消耗资源或误转录 |
| 自动加载 | 打开视频时只加载字幕库中的已有字幕，不自动转录 | 生成需要用户明确选择源语言，避免误用语言 |
| 存储 | 默认 `~/Library/Application Support/Otoha/Subtitles`，每个视频哈希目录 | 对用户可见但不污染视频目录，且能保留多个语言版本 |
| 覆盖策略 | 同一媒体和语言对成功生成后覆盖；其他语言对保留 | 重生成结果可预测，历史选择不互相覆盖 |
| 显示方式 | 原文、译文、双语三选一，按视频记忆，默认双语 | 同一视频的学习/阅读需求通常稳定 |
| 输出 | ASS 逻辑高度为 1080，宽度按视频比例计算，左右各留 5% 边距；默认源文 38px、译文 34px，按实际字形宽度和语言边界换行；源文在上、译文在下，源文约 31% 透明度，配黑色描边和轻阴影 | 同一视频比例不因像素分辨率改变排版；支持单语显示缓存，字号比例可在 80% 至 140% 间调整 |
| 焦点 | helper 正常运行不激活窗口；只有系统级权限/资源提示可能打断 | 尽量不影响用户观看 |
| 兼容性 | 当前只验收 Apple Silicon + macOS 26.4+ | Apple Translation API 和打包校验以当前设备为目标 |

## 侧栏信息顺序

侧栏保持从当前视频到操作再到反馈的阅读顺序：

1. **当前视频**：单行省略，悬停显示完整名称。
2. **字幕列表**：存在字幕时显示下拉选择；已加载状态用标题后的图标表示；Finder 操作紧邻选择框。
3. **生成字幕**：音轨、源语言、目标语言集中在表单；主按钮只使用“生成”。
4. **任务反馈**：阶段和错误详情折叠，进度有可靠数值时才显示；失败保留重试和取消边界。
5. **播放选项**：自动加载和问号帮助图标；显示方式使用紧凑下拉框。

全局设置放在 Preferences，包括默认语言、FFmpeg 路径、字幕库根目录、自动加载和字号。侧栏集中展示当前视频、字幕列表、生成操作和播放选项。

## 任务状态

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> running: 点击生成
    running --> canceling: 用户取消/切换视频
    canceling --> cancelled: helper 返回 cancelled
    running --> loading: helper 返回 completed
    loading --> completed: IINA 确认外挂轨道
    loading --> loadError: 超时或加载失败
    running --> error: helper error / 进程异常
    completed --> running: 重新生成
    error --> running: 重试
    loadError --> loading: 重试加载
```

此图描述用户可见的任务状态。helper 阶段、状态字段和错误码以 [protocol v1](runtime-state-and-protocol-v1.md) 为准。媒体切换会取消旧任务，并丢弃已过期的异步结果。

## V1 明确不做

- 播放期间实时转录、批量任务、多音轨同时处理。
- 自动识别源语言、自动选择最佳音轨或从字幕网站下载字幕。
- 云端转录/翻译、字幕编辑器、同步到视频目录。
- 独立 helper 安装器、Intel/Universal 兼容包。

自动化检查与人工验收范围见[开发指南](development.md#验证范围)。

## 参考

- [IINA Creating Plugins](https://docs.iina.io/pages/creating-plugins.html)
- [IINA Developer Guide](https://docs.iina.io/pages/dev-guide.html)
- [Khuaplayer CaptionTranscriber](https://github.com/nake13/khuaplayer/blob/main/Modules/Captions/CaptionTranscriber.swift)
- [Khuaplayer CaptionTranslator](https://github.com/nake13/khuaplayer/blob/main/Apps/Mac/CaptionsHost/CaptionTranslator.swift)
- [Khuaplayer MediaCore audio reader](https://github.com/nake13/khuaplayer/blob/main/Modules/MediaCore/Bridge/SPCaptionAudioReader.mm)
