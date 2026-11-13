<p align="center">
  <img src="assets/otoha-icon.svg" alt="Otoha 图标" width="96" height="96">
</p>

<h1 align="center">Otoha</h1>

<p><strong>在 IINA 中生成、校对和导出双语字幕。</strong></p>

<p>选择本地视频的音轨和语言，用 Apple Speech 与 Translation 在 Mac 上完成转录与翻译，生成的字幕自动加载到播放器。</p>

## 界面预览

真实 IINA 中的开发版本截图，已发布功能以 [Releases](https://github.com/BBboy01/otoha/releases) 为准。

| 首页 | 校对字幕 |
| --- | --- |
| <img src="https://github.com/user-attachments/assets/893f0a2b-c686-461a-82ba-2a8eef475dd3" alt="Otoha 首页" width="300"> | <img src="https://github.com/user-attachments/assets/365889aa-7394-4131-89f4-4949a1503d91" alt="字幕校对页" width="300"> |

## 功能

- 生成双语 ASS 字幕，支持原文、译文或双语显示，长句自动换行。
- 逐句校对原文和译文，联动视频定位，保存后更新字幕。
- 按视频管理字幕版本，重新生成保留已有字幕及人工校对。
- 导出原文、译文或双语 SRT。

## 安装

需要已安装 IINA 的 Apple Silicon Mac，运行 macOS 26.4 或更新版本，并安装 FFmpeg 与 FFprobe：

```bash
brew install ffmpeg
```

从 [Releases](https://github.com/BBboy01/otoha/releases) 下载 `.iinaplgz` 插件包，用 IINA 打开，或在 Settings > Plugins 中安装。更新时先移除旧版，再安装新版。

源码构建与开发包更新见[开发指南](docs/development.md)。

## 使用

1. 在 IINA 打开本地视频，从 Plugins 菜单打开 Otoha 侧栏。
2. 选择音轨、源语言和目标语言，点击“生成”，完成后字幕自动加载。
3. 在“字幕”区域切换版本和显示方式，使用右侧图标进入校对或导出 SRT。

开启“自动加载”后，再次打开视频会加载已有字幕。字幕默认保存在 `~/Library/Application Support/Otoha/Subtitles/`，SRT 导出到字幕库的 `Exports` 子目录。字幕库位置和字号可在 Otoha Preferences 中调整。

在 Otoha Preferences 的“字幕样式”中可设置字体、字号、文字颜色、半透明黑底和原文弱化，并查看固定双语示例的实时预览。修改后返回播放窗口应用到当前已加载字幕，无需重新转录；校对或生成期间可在操作结束后返回播放窗口应用。已有 ASS 文件保持不变，新生成的 ASS 使用所选样式。默认 Arial，字体不可用时由播放器回退；SRT 不携带字体样式。

## Roadmap

后续计划方向，尚未实现：

- [ ] 批量生成与任务队列。
- [ ] 外部音轨输入。
- [ ] 字幕时间轴调整、片段拆分与合并。

## 开发

构建、测试与贡献见[开发指南](docs/development.md)，其他说明见[文档索引](docs/README.md)。遇到问题可查阅[排障指南](docs/troubleshooting.md)。
