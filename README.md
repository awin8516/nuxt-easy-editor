# nuxt-easy-editor

为 Nuxt.js 项目提供可视化编辑功能的插件。在开发环境下，可以直接在浏览器中编辑页面内容及CSS，并自动更新本地源文件。

## 功能特性

- 🎨 可视化编辑：鼠标滑入可编辑元素即可看到编辑按钮
- 📝 实时更新：修改后直接保存到本地源文件
- 🔍 智能匹配：自动在配置的源文件中查找内容
- 📋 多位置选择：当内容在多个位置出现时，提供选择界面
- ⚡ 零配置：安装后只需简单配置即可使用

## 安装

```bash
npm install -D nuxt-easy-editor
```

## 使用方法

### 1. 安装插件

```bash
npm install -D nuxt-easy-editor
```

### 2. 在 `nuxt.config.ts` 中配置

```typescript
export default defineNuxtConfig({
  modules: ['nuxt-easy-editor'],
  
  visualEditor: {
    // 指定可编辑的标识（支持字符串或数组）
    // 可以是属性名（如 'easy-editor'）或 HTML 标签名（如 'h1', 'p'）
    tagKey: ['easy-editor', 'h1', 'h2', 'h3', 'p'],
    editCSS: true,

    // 配置页面路径到源文件的映射
    sourceMap: {
      '/': [
        'src/pages/index.vue'
      ],
      '/about': [
        'src/pages/about.vue',
        'src/components/AboutSection.vue'
      ],
      // 支持通配符*页面路径,如'/works/123'
      '/works/*': [
        'src/pages/works/[id].vue'
      ],
      // 支持通配符文件路径
      '/i18n': [
        'src/i18n/**/*.json'
      ],
      // 默认映射,当页面路径未配置时,默认映射到该路径
      'default': [
          'src/pages/index.vue'
      ]
    }
  }
})
```

**注意**：只需要 2 步即可使用：
1. `npm install -D nuxt-easy-editor`
2. 在 `nuxt.config.ts` 中配置 `modules` 和 `visualEditor`

### 3. 在页面组件中添加可编辑标记

```vue
<template>
  <div>
    <h1 easy-editor>这是可编辑的标题</h1>
    <p easy-editor>这是可编辑的段落内容</p>
  </div>
</template>
```

### 4. 启动开发服务器

```bash
npm run dev
```

现在，当你将鼠标悬停在带有 `easy-editor` 属性的元素上时，会显示编辑按钮。点击后可以编辑内容并保存到源文件。

## 配置说明

### `tagKey`

指定用于标记可编辑元素的标识。默认为 `'easy-editor'`。支持字符串或字符串数组。

支持两种匹配方式：
- **属性名**：如 `'easy-editor'`，匹配带有该属性的元素（如 `<h1 easy-editor>标题</h1>`）
- **HTML 标签名**：如 `'h1'`、`'h2'`、`'p'` 等，匹配所有该标签的元素（如所有 `<h1>` 标签）

示例：
```typescript
// 方式1：单个属性
tagKey: 'easy-editor'  // 匹配 <h1 easy-editor>标题</h1>

// 方式2：单个标签名
tagKey: 'h1'  // 匹配所有 <h1> 标签

// 方式3：数组形式（推荐）- 同时支持多个标识
tagKey: ['easy-editor', 'h1', 'h2', 'h3', 'p']  
// 匹配：
// - 所有带有 easy-editor 属性的元素
// - 所有 <h1> 标签
// - 所有 <h2> 标签
// - 所有 <h3> 标签
// - 所有 <p> 标签
```
### `sourceMap`

页面路径到源文件路径的映射对象。

- **键**：页面路径，支持通配符（如 `/about`、`/works/*`、`/`）
- **值**：源文件路径数组（支持绝对路径或相对于项目根目录的路径）
- **通配符支持**：支持使用 `*` 和 `?` 通配符，如 `src/i18n/**/*.json` 会匹配所有子目录下的 JSON 文件

## 工作原理

1. 插件在开发环境下注入客户端脚本
2. 监听带有指定属性的 DOM 元素
3. 鼠标悬停时显示编辑内容、编辑CSS按钮
4. 点击后搜索配置的源文件，查找匹配的内容
   4.1 编辑内容：
      - 以浏览器页面原始内容，按替换前后空格，换行符替换规则生成变体数组，分别与源文件内容进行匹配
      - 匹配1处成功后，将源文件内容赋值给页面contenteditable编辑框
      - 匹配多处成功后，以抽屉弹窗形式展示所有匹配内容列表，用户可选择更新哪一处
      - 修改为新内容后，点击保存按钮会更新源文件
      - 会保留原始内容的空格、换行符等格式
      - 仅更新匹配到的内容，其他部分保持不变
      - 源文件中 <br> \n  修改前，修改后，要保证格式一致性
   4.2 编辑CSS：
      - 以className,及ID，结合父元素className,及ID，生成selectors变体数组,分别与源文件内容进行匹配
      - 以抽屉弹窗形式展示匹配内容
      - 修改为新内容后，点击保存按钮会更新源文件
5. 如果有多处匹配，提供选择界面
6. 编辑后通过 API 更新源文件
7. 自动刷新页面以显示更改

## 注意事项

- 仅在开发环境（`dev` 模式）下启用
- 确保配置的源文件路径正确
- 文件路径支持绝对路径和相对路径（相对于项目根目录）
- 修改内容时请确保格式正确，避免破坏代码结构

## License

MIT

