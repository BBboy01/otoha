<p align="center">
  <img src="assets/otoha-icon.svg" alt="Otoha 图标" width="96" height="96">
</p>

<h1 align="center">Otoha</h1>

<p><strong>面向 IINA 的本机字幕转录与翻译插件</strong></p>

<p>选择音轨和语言，为本地视频生成字幕并自动加载到播放器。</p>

> 运行要求：Apple Silicon Mac，macOS 26.4 或更新版本。

## 界面预览

![Otoha 在 IINA 中的侧栏与双语字幕](assets/otoha-in-iina.png)

*IINA 中的 Otoha 侧栏、播放选项和双语字幕。*

![长双语字幕按视频宽度换行](assets/otoha-subtitle-wrapping.png)

*长字幕根据视频宽高比和实际字形宽度换行。*

## 功能

- 选择视频中的音轨和源语言、目标语言，在后台完成转录与翻译。
- 生成源文在上、译文在下的 ASS 字幕，长句按画面比例与文字宽度换行。
- 按视频记忆显示方式，可选择原文、译文或双语。
- 将字幕库中的 ASS 导出为原文、译文或双语 SRT，保存到字幕库的 `Exports` 目录。
- 开启自动加载后，打开视频时会加载字幕库中的已有字幕；没有字幕时可手动生成。
- 重生成同一视频和语言对时替换对应字幕，其他语言版本保留。
- 随插件提供 Swift helper，无需单独安装或启动。

转录和翻译使用 Apple Speech 与 Translation。媒体处理由本机 FFmpeg 完成，Otoha 不提供云端处理服务。

## 安装

### 前置条件

1. 已安装 IINA。
2. 使用 Apple Silicon Mac，运行 macOS 26.4 或更新版本。
3. 安装 FFmpeg 和 FFprobe。推荐使用 Homebrew：

   ```bash
   brew install ffmpeg
   ```

### 从 Release 安装

前往 [GitHub Releases](https://github.com/BBboy01/otoha/releases)，下载 `Otoha-v<版本>-macos-arm64.iinaplgz`，用 IINA 打开，或在 IINA 的 Plugins 设置中安装。并非每次代码更新都会发布新版本，请以 Releases 页面为准。

### 更新 Release 版本

从 [GitHub Releases](https://github.com/BBboy01/otoha/releases) 下载新版插件。在 IINA 的 Settings > Plugins 中移除当前 Otoha，再用 IINA 打开新版 `.iinaplgz` 文件，或从 Plugins 设置安装。若当前安装的是源码开发包，请先解除开发包链接，再按[开发指南](docs/development.md#更新开发包)更新；同一时间只保留一个 Otoha 安装项，避免重复插件标识符。

### 从源码安装

```bash
git clone https://github.com/BBboy01/otoha.git
cd otoha
make package verify-package
/Applications/IINA.app/Contents/MacOS/iina-plugin link "$PWD/dist/Otoha.iinaplugin"
```

重新构建默认输出前，运行 `make clean-package`；它只删除 `dist/Otoha.iinaplugin`。也可以通过 `PACKAGE_DIR=/绝对路径` 指定其他输出目录。重新安装开发包前，先在 IINA Plugins 设置中移除旧的开发包链接，避免出现重复插件标识符。打开 IINA 后，从 Plugins 菜单打开 Otoha 侧栏。插件包已包含 `OtohaHelper.app`。

IINA 官方说明：[Creating Plugins](https://docs.iina.io/pages/creating-plugins.html) · [Developer Guide](https://docs.iina.io/pages/dev-guide.html)。

## 使用

1. 在 IINA 打开一个本地视频。
2. 打开 Otoha 侧栏，选择视频内的音轨及源语言、目标语言。
3. 点击“生成”，等待字幕完成并自动加载。
4. 用“显示”下拉框选择原文、译文或双语；该设置按视频记忆。

### 自动加载

开启“自动加载”后，Otoha 会在打开视频时查找并加载已有字幕。没有字幕时不会自动转录，选择语言后点击“生成”即可创建。

### 校对与版本

已有字幕时，侧栏优先显示版本选择和“校对字幕”，“重新生成”配置默认折叠。重新生成前会确认，并创建带编号的新版本，保留原有字幕和人工校对。列表显示语言对与版本号，完整文件名在“文件详情”中。

校对视图显示当前句数和未保存标记；“保存并下一句”只在保存成功后跳转。导出按钮中可选择 SRT 的原文、译文或双语，删除操作位于更多菜单中。

### 字幕样式

双语模式下源文位于上方并淡化显示，译文位于下方。可在 Otoha Preferences 调整字号，默认比例为 100%，范围为 80% 至 140%。字幕会随视频比例调整并按可用宽度换行；已生成字幕保留原有排版，调整字号后需要重新生成。

## 字幕保存位置

默认字幕库位于：

```text
~/Library/Application Support/Otoha/Subtitles/
```

每个视频使用独立目录，字幕文件名包含源语言和目标语言。可在 Otoha Preferences 中更改字幕库根目录；侧栏可定位当前选中的字幕文件，也可把 ASS 导出为 SRT 到字幕库根目录下的 `Exports` 子目录，并在 Finder 中定位导出文件。SRT 只保留文本与时间，不含 ASS 样式；重名时会创建带编号的副本。

侧栏也可删除选中的单个字幕文件，删除前会显示视频和语言对并要求确认。

## 限制

- 仅处理本地视频和视频文件内的一个音轨，不支持外部音轨或实时转录。
- 生成前需要明确选择源语言和目标语言，不会自动识别源语言。
- 目前仅提供 Apple Speech 与 Translation 后端，暂不支持云端服务、批量队列或字幕编辑。
- 发布包面向 Apple Silicon，不提供 Intel 或 Universal 版本。
- 首次使用语言资源时，macOS 可能显示权限或资源准备提示。

## 开发

常用检查：

```bash
make help
make test
```

本地构建、测试、调试和打包说明见[开发指南](docs/development.md)。

## 文档

开发、架构、协议、排障与发布文档见[文档索引](docs/README.md)。
