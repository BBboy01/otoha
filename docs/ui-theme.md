# UI 主题规范

`plugin/theme.css` 是侧栏、校对页、弹窗和插件设置页共用的设计变量入口。两个 HTML 页面必须先加载它，再加载各自的组件样式。新增样式资源同时加入 `scripts/plugin-files.txt`。

本轮只迁移变量，不调整视觉设计。默认颜色、控件大小和间距保持原样；没有主题切换器或额外运行时依赖。深浅色仍跟随系统。

## 变量分层

所有变量使用 `--otoha-` 前缀。

| 类别 | 示例 | 使用规则 |
| --- | --- | --- |
| 基础间距 | `--otoha-space-unit`、`--otoha-space-2` | 基础单位为 4px，尺度通过 `calc()` 派生；半级用于密集工具界面 |
| 语义间距 | `--otoha-sidebar-padding-inline`、`--otoha-dialog-padding` | 组件优先表达用途，再引用基础尺度 |
| 文字 | `--otoha-font-size-body`、`--otoha-font-weight-heading` | 字族、字号、字重、行高统一引用变量 |
| 颜色 | `--otoha-color-surface`、`--otoha-color-text-muted` | 按表面、文字、边框、操作和状态命名，组件不直接使用色值 |
| 尺寸 | `--otoha-control-height`、`--otoha-icon-size` | 高度、图标、弹窗宽度、编辑区尺寸按用途命名 |
| 细节 | `--otoha-radius-control`、`--otoha-shadow-menu` | 圆角、边框、焦点、阴影、层级和禁用透明度集中定义 |

不为每个选择器或每个数值创建独立变量。同一用途复用同一变量；即使当前数值相同，不同用途也不能强行绑定，例如图标大小与面板留白。

## 组件使用

```css
.subtitle-actions {
  gap: var(--otoha-space-1-5);
}

#export-dialog {
  padding: var(--otoha-dialog-padding);
  border-radius: var(--otoha-radius-dialog);
  background: var(--otoha-color-surface);
}
```

设计值只能在 `theme.css` 中定义。组件可以引用或重映射已有变量，不写入新的尺寸、颜色、字号或阴影字面量。`0`、`auto`、`none`、`currentColor`、`transparent`、布局比例及 SVG 路径坐标不属于主题设计值。

组件差异应显式重映射，例如设置页的普通控件使用 `--otoha-control-height-roomy`，侧栏使用更紧凑的 `--otoha-control-height`。设置页保留系统原生强调色；可通过 `--otoha-control-accent` 配置。改主题时同时定义强调色的默认、悬停、边框和前景状态，避免只替换主色。

## 兼容与断点

`--otoha-space-action-gap`、`--otoha-space-label-gap`、`--otoha-space-row-gap`、`--otoha-space-section-inset`、`--otoha-sidebar-padding-top` 和 `--otoha-space-section-gap` 暂时保留原有非标准间距。后续美化时在主题入口统一调整，新组件优先使用基础尺度，不新增临时间距。

原生媒体查询不能使用普通 CSS 自定义属性。因此窄侧栏的 280px / 281px 和矮编辑区的 600px 断点保留为查询常量；与之对应的声明仍使用主题变量。不引入只为替换断点而存在的 CSS 构建步骤。

## 验证

`npm test --prefix plugin` 包含主题约束检查：两个页面的加载顺序、资源打包清单、变量引用完整性，以及组件样式中新增的尺寸和色值字面量。

修改基础变量后，检查深浅色、窄宽侧栏，以及首页、更多菜单、导出、删除确认、校对、错误反馈和设置页。除默认渲染外，还应覆盖控件高度、间距和强调色，确认变量会影响实际计算样式。
