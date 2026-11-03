# 开发指南

本项目由 IINA JavaScript 插件和 Swift Package helper 组成。开发时优先修改小模块，并用对应测试验证。字幕渲染和 UI 检查使用合成或已获授权的测试素材。

## 环境

| 工具 | 要求 |
| --- | --- |
| macOS | 26.4+，Apple Silicon 目标包为 arm64 |
| IINA | 安装在 `/Applications/IINA.app`，用于手动侧栏验收 |
| Node.js | 能运行插件 Node 测试 |
| Swift | 6.2 工具链，能构建 `helper/Package.swift` |
| FFmpeg | 真实转录和包验证需要；插件与 helper 单元测试不依赖媒体文件 |

请勿将 `.env`、凭据、媒体文件、生成的字幕、日志或 `helper/.build` 提交到仓库。

## 常用命令

```bash
# 插件单元测试
npm test --prefix plugin

# helper 单元测试
swift test --package-path helper

# Release 构建
swift build -c release --package-path helper

# 生成一个临时插件包并检查包内容
package_dir="$(mktemp -d)/Otoha.iinaplugin"
bash scripts/package-plugin.sh "$package_dir"
bash scripts/verify-plugin-package.sh "$package_dir"

# 仅检查语法和空白
node --check plugin/main.js
node --check plugin/sidebar.js
git diff --check
```

`package-plugin.sh` 会先构建 helper，再按 `scripts/plugin-files.txt` 复制插件资源，最后写入 helper 源码哈希、二进制哈希和架构证据。输出目录必须不存在，避免把旧文件误混进新包。

## 本地安装和卸载

```bash
IINA_PLUGIN=/Applications/IINA.app/Contents/MacOS/iina-plugin
"$IINA_PLUGIN" link /absolute/path/to/Otoha.iinaplugin
"$IINA_PLUGIN" unlink /absolute/path/to/Otoha.iinaplugin
```

开发链接会以 `*.iinaplugin-dev` 形式注册。切换安装包前先 unlink 旧链接；同一个 `io.otoha.iina` 同时存在多个链接会触发 IINA 的重复 identifier 警告。每次改动 JavaScript 后可在 IINA Plugins 设置中 reload；helper Swift 改动需要重新 package 并重新 link。

## 代码分层

- `plugin/`：IINA 适配、状态 store、侧栏 UI、字幕库客户端、任务控制器和协议解析。
- `helper/Sources/OtohaCore/`：无 UI 的任务核心、FFmpeg、字幕文件名/库、ASS 输出和取消令牌。
- `helper/Sources/OtohaHelper/`：macOS App 入口、Speech/Translation 适配、后台 JSONL 事件。
- `plugin/test/` 与 `helper/Tests/`：协议、状态并发、字幕渲染、文件发布和取消的 focused tests。
- `scripts/`：打包和包完整性验证；`.github/workflows/ci.yml`：测试、打包、Release 归档。

## 新增或修改功能

### 修改侧栏行为

1. 在状态或 controller 模块中定义行为，避免把任务真相塞进 DOM。
2. 用 `runtimeStore` 的完整快照驱动 UI；通过 sidebar message 发送用户意图。
3. 为媒体切换、重复点击、空字幕库、加载失败和取消增加 focused test。
4. 若改变用户可见结构，检查键盘顺序、`label`/`aria-*`、窄侧栏溢出和长文件名省略。

### 修改 helper protocol

1. 先更新 [protocol v1](runtime-state-and-protocol-v1.md) 的字段、阶段或错误码。
2. Swift 事件和 JavaScript `parseHelperEvent` 必须在同一个改动中更新。
3. 新字段优先可选；改变字段含义或状态机才升级 `protocolVersion`。
4. 增加一个有效事件测试和一个未知/无效事件测试，不能用中文 message 作为分支条件。

### 修改字幕输出

ASS 写入必须经过临时文件和成功后的替换路径。不要直接覆盖最终文件，也不要把 IINA 内存显示模式缓存写回字幕库。默认源文 38px、译文 34px，字号比例由 Preferences 的 80% 至 140% 设置控制。源文约 31% 透明度，二者使用黑色描边和轻阴影。

`ASSWriter` 使用固定逻辑高度 1080，逻辑宽度由视频宽高比计算，`PlayRes` 与 `LayoutRes` 一致；左右各留约 5% 边距。同一画面比例在不同像素分辨率下输出相同布局，缺少有效尺寸时回退到 1920×1080。保持 Translation 事件在前、Source 在后且同为 Layer 0，让 libass 碰撞避让将源文放在多行译文上方。

英文使用 `WrapStyle: 1` 交给 libass 按可用宽度换行。IINA 的 mpv 不为原生 ASS 启用 `ASS_FEATURE_WRAP_UNICODE`，因此 `SubtitleLineBreaker` 为非 ASCII 文本使用 CoreText 的 Unicode 换行机会与字形测量，并保留显式换行。测量前按每个实际回退字体的 OpenType OS/2 Windows ascent/descent 将 ASS 字号换算为 CoreText point size，避免中文回退字体被高估而提前换行；没有 OS/2 表时使用 CoreText 行高度量。不要恢复按固定字符数切行或强制均分行宽。

修改字号、样式或换行策略时，保留源文/译文的顺序和时间戳，同时更新 Swift 输出测试、JavaScript 显示模式夹具和相关文档，并用合成媒体完成一次 IINA 实际渲染检查。截图应展示长英文、中日文、混排、窄画面以及双语避让。已有 ASS 不会自动改写，需要重新生成才能采用新排版。

## 验证范围

CI 和单元测试验证插件状态与协议、Swift 字幕流水线、包资源完整性和发布归档。它们不能代替以下需要 macOS 与 IINA 的人工检查：

- Apple Speech 和 Translation 首次准备资源时的系统提示。
- 不同容器和多音轨文件中的 `ff-index` 映射。
- IINA 确认外挂 ASS 轨道加载的行为。
- VoiceOver、深色模式、窄侧栏和长文件名下的界面表现。

需要截图或渲染证据时，使用合成或获授权的测试素材；不要把素材、字幕或包含本机路径的日志加入仓库。

## 测试重点

| 变更 | 至少验证 |
| --- | --- |
| 状态或 UI | `npm test --prefix plugin`，重点检查 sidebar、runtime、媒体切换 |
| protocol | parser、未知事件、错误码和 jobId 过滤 |
| helper 核心 | `swift test --package-path helper`，重点检查取消、FFmpeg、ASS 原子发布 |
| 包资源 | package + verify，另验证 unlisted resource 和替换 binary 会失败 |
| Release 工作流 | 本地 `git cliff --unreleased`，tag 由 CI 负责归档并校验 |

记录人工检查时，区分自动化结果和 IINA/macOS 实机结果，不要把 fixture 通过写成实机通过。

## 调试

- IINA 侧：使用插件 reload、Developer Tool 和插件日志；先记录当前媒体路径、音轨 `id`/`ff-index`、jobId 和 phase。
- helper 侧：正常任务保持后台模式。只有需要观察原生 SwiftUI 状态时，才用 `--ui` 或 `OTOHA_DEBUG_BUNDLE=1` 启动调试 bundle。
- helper 事件：插件按 `protocolVersion`、事件类型、阶段、任务 ID 和错误码校验 JSONL；未知值会被丢弃。分支逻辑使用稳定错误码，不要依赖展示用的中文 `message`，见 [protocol v1](runtime-state-and-protocol-v1.md#5-稳定错误码)。
- 临时打开 `OTOHA_DEBUG_ERRORS=1` 可在 helper 错误中包含 NSError domain/code；不要把可能含路径的调试输出提交到仓库。
- 遇到“字幕已生成但加载失败”，先保留 ASS，检查 `track-list` 是否出现对应绝对路径，再判断是 IINA 加载确认问题还是字幕内容问题。

## 提交约定

提交信息遵循 Conventional Commits，例如 `feat(plugin): remember display mode`、`fix(helper): clean up ffmpeg on cancel`、`docs: explain local installation`。不要提交生成的 `dist/`、运行日志、媒体或字幕文件。
