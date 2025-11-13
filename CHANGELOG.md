# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/lang/zh-CN/).

## [1.0.5] - 2025-11-7
### Changed
- 修改安装命令，只在开发环境devDependencies

## [1.0.1] - 2025-11-7

### Added
- 新增 CSS 编辑功能（`editCSS` 配置项）
- 支持编辑 Vue 文件中的 `<style scoped>` 标签
- 支持通过父元素的 class/id 智能匹配 CSS 选择器（如 `.slogan h3`）
- 新增 `search-css.ts` 和 `update-css.ts` API 端点
- 右侧抽屉式 CSS 编辑器界面
- 当 `tagKey` 包含 `img`、`video`、`audio` 时，自动隐藏"编辑内容"按钮

### Fixed
- 修复特殊符号（如 `&`）在搜索和保存时的转义问题
- 修复编辑按钮容器在鼠标滑出后的隐藏逻辑
- 修复 `startEditCSS` 函数未定义的错误
- 优化 HTML 实体处理（`&amp;` ↔ `&`）

### Changed
- 多文件匹配选择界面改为右侧抽屉式弹窗
- 优化内容高亮显示，增加更多上下文（前后各 5 行）
- 改进匹配项显示，添加行号和匹配行高亮
- 优化按钮显示逻辑，统一使用按钮容器

## [1.0.0] - 2025-11-7

### Added
- 初始版本发布
- 可视化内容编辑功能
- 支持通过 `tagKey` 配置可编辑元素（支持字符串或数组）
- 支持 HTML 标签名作为可编辑标识（如 `h1`、`p` 等）
- 支持 `searchHtml` 配置，控制是否搜索 HTML 标签内容
- 支持 `sourceMap` 配置，映射页面路径到源文件
- 支持 glob 模式文件路径（如 `src/i18n/**/*.json`）
- 多文件/多位置匹配选择功能
- 内联编辑功能（使用 `contenteditable`）
- 鼠标滑入时的高亮提示
- 自动保存到本地文件
- 保存成功后自动刷新页面

