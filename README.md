# SillyTavern Immersive Reading / 沉浸式阅读

给 SillyTavern 用的阅读排版扩展，主要优化长文本 RP 在手机上的阅读体验。

不会改动酒馆原本的消息楼层，编辑、删除、swipe、时间戳、楼层号这些都正常保留。排版只是叠加一层"阅读视图"，随时可以关掉。

## 功能

- 单换行自动转段落，支持首行缩进和两端对齐
- 字号、行高、段距、缩进、边距、最大宽度都能单独调
- 用户消息可以折叠成一条分隔线，或者完全隐藏
- 原生工具栏可以折叠，点消息头部展开
- 字体跟随酒馆，也支持自定义
- 表格、代码块、图片、酒馆助手等复杂内容保持原生渲染，不会被接管
- 对移动端做了独立的宽度和边距控制
- 对某些把头像/时间戳挤在两侧导致正文变窄的主题，提供布局兼容选项

## 安装

SillyTavern 扩展页面 → 安装第三方扩展，填入：

```
https://github.com/vexory/SillyTavern-Immersive-Reading
```

装完在扩展列表里找到 **沉浸式阅读**，勾选启用即可。

## 自定义字体

字体下拉选"自定义"，填 CSS `font-family` 值就行，比如：

```
LXGW WenKai, "Noto Serif SC", serif
```

多个字体用英文逗号分隔，带空格的字体名加英文引号。不要写 `font-family:`，末尾不要加句号。

## 样式自定义（进阶）

想进一步微调阅读排版，可以在 SillyTavern 的自定义 CSS 里用这些类：

```css
body.stir-reader-active { }
body.stir-reader-active .stir-reader-projection { }
body.stir-reader-active .stir-user-fold-line { }
body.stir-reader-active.stir-layout-clean { }
```

比如让引号、引用块、代码块在阅读模式下回归正文样式：

```css
body.stir-reader-active .stir-reader-projection q,
body.stir-reader-active .stir-reader-projection blockquote,
body.stir-reader-active .stir-reader-projection code {
    font-size: inherit !important;
    font-family: inherit !important;
    line-height: inherit !important;
}
```

## 常见问题

**某些 HTML 没有变成阅读段落？**
表格、代码块、按钮、图片、酒馆助手这类复杂内容会保持酒馆原生渲染，避免破坏交互。

**会动我的主题吗？**
不会。背景、气泡、颜色、顶栏、输入栏都交给酒馆和你自己的 CSS，这个扩展只管阅读排版。

## ⚖️ 声明 / Disclaimer

本扩展为社区作品，非 SillyTavern 官方出品。  
This is a community extension and is not officially affiliated with the SillyTavern team.

## License

MIT
