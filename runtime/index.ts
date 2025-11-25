// 导入content编辑入口函数
import { startEditContent } from './edit-content'

// 导入CSS编辑入口函数
import { startEditCSS } from './edit-css'

// 源文件映射配置
export interface SourceMap {
  [key: string]: string[]
}

// 可视化编辑器运行时配置
export interface VisualEditorRuntimeConfig {
  tagKey: string | string[]
  sourceMap: SourceMap
  editCSS?: boolean
  debug?: boolean
}

// 编辑器状态
interface EditorState {
  element: HTMLElement | null
  isEditing: boolean
}

// 全局状态管理
export let editorState: EditorState = {
  element: null,
  isEditing: false
}

// 导入编辑器样式
const link = document.createElement('link')
link.rel = 'stylesheet'
// 尝试不同的CSS文件路径，确保能正确加载
link.href = '/_nuxt/easy-editor/runtime/css/style.css'

// 添加错误处理，如果CSS加载失败，尝试使用备用路径
link.onerror = function() {
  console.warn('尝试使用备用CSS路径')
  link.href = '/easy-editor/runtime/css/style.css'
}

document.head.appendChild(link)

// 当前高亮的元素
let currentHighlightedElement: HTMLElement | null = null

/**
 * 构建URL路由候选列表，生成可能的路由变体
 * @param routename 原始路由名
 * @returns 路由候选数组
 */
export function buildRouteCandidates(routename: string): string[] {
  const candidates: string[] = []
  const segments = routename.split('/').filter(Boolean)

  // 添加完整路由
  candidates.push(routename)

  // 添加 shorter versions
  for (let i = segments.length - 1; i > 0; i--) {
    const candidate = `/${segments.slice(0, i).join('/')}`
    candidates.push(candidate)
  }
  // 去重
  const routes = Array.from(new Set(candidates))
  console.log('[buildRouteCandidates] 生成的路由候选列表:', routes) 
  return routes
}

/**
 * 根据当前路由解析对应的源文件列表
 * @param routename 当前页面路由
 * @param sourceMap 源文件映射配置
 * @returns 匹配的源文件路径数组
 */
export async function resolveSourceFiles(routename: string, sourceMap: SourceMap): Promise<string[]> {
  const candidates = buildRouteCandidates(routename)
  const sourceFiles: string[] = []

  // 收集所有匹配的源文件
  for (const candidate of candidates) {
    if (sourceMap[candidate]) {
      sourceFiles.push(...sourceMap[candidate])
    }
  }

  // 添加默认映射的源文件
  if (sourceMap.default) {
    sourceFiles.push(...sourceMap.default)
  }

  // 去重
  const uniqueSourceFiles = Array.from(new Set(sourceFiles))
  
  // 检查是否需要解析通配符
  const hasWildcards = uniqueSourceFiles.some(file => file.includes('*'))
  
  if (hasWildcards) {
    try {
      // 调用find-file接口解析通配符
      const response = await fetch('/api/easy-editor/find-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          patterns: uniqueSourceFiles
        })
      })
      
      const result = await response.json()
      
      if (result.files) {
        console.log('【解析通配符文件路径】', result.files)
        return result.files
      }
    } catch (error) {
      console.error('【解析通配符文件路径失败】', error)
    }
  }
  console.log('【解析文件路径】', uniqueSourceFiles)
  return uniqueSourceFiles
}

// 生成rawHtmlContent的内容变体数组
export function generateContentVariants(content: string): string[] {
  const variants: string[] = []

  // 变体1: 默认原始不变
  variants.push(content)

  // 变体2: 替换前后空格或特殊字符
  variants.push(content.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, ''))

  // 变体3: 浏览器页面中换行，替换成<br>
  variants.push(content.replace(/\n/g, '<br>'))

  // 变体4: 浏览器页面中换行，替换成<br />
  variants.push(content.replace(/\n/g, '<br />'))

  // 变体5: 浏览器页面中换行，保持为\n（不做转换）
  variants.push(content.replace(/\n/g, '\\n'))

  // 数组去重
  return [...new Set(variants)]
}

/**
 * 初始化可视化编辑器
 * @param config 可视化编辑器运行时配置
 * @description 初始化可视化编辑器，配置标签键、绑定高亮事件、源文件映射和是否编辑CSS
 */
export async function initVisualEditor(config: VisualEditorRuntimeConfig) {
  // 获取当前页面路由
  const routename = window.location.pathname || '/' 

  // 解析源文件列表
  const sourceFiles = await resolveSourceFiles(routename, config.sourceMap)

  // 设置编辑器状态
  editorState.element = document.documentElement

  console.log('[easyEditor] 配置:', config)

  // 页面加载时的调试日志
  if (config.debug) {
    const routeCandidates = buildRouteCandidates(routename);
    console.log('[Visual Editor] 页面加载:', {
      页面路由: routename,
      路由变体: routeCandidates,
      文件映射数组: sourceFiles
    });
  }

  // 初始化编辑按钮
  const editContainer = document.createElement('div')
  editContainer.classList.add('visual-editor-toolbar')
  editContainer.style.display = 'none' // 默认隐藏工具栏

  // 创建编辑内容按钮
  const editContentBtn = document.createElement('button')
  editContentBtn.textContent = '编辑内容'
  editContentBtn.classList.add('visual-editor-btn')

  // 创建编辑CSS按钮
  const editCSSBtn = document.createElement('button')
  editCSSBtn.textContent = '编辑CSS'
  editCSSBtn.classList.add('visual-editor-btn')

  // 根据配置决定是否显示CSS编辑按钮
  if (config.editCSS) {
    editContainer.appendChild(editCSSBtn)
  }

  editContainer.appendChild(editContentBtn)
  document.body.appendChild(editContainer)

  // 检查元素是否是可编辑目标
  function findEditableTarget(target: EventTarget | null): HTMLElement | null {
    const tagKeys = Array.isArray(config.tagKey) ? config.tagKey : [config.tagKey]
    let currentElement: HTMLElement | null;

    // 获取实际的HTMLElement（处理文本节点等情况）
    if (target instanceof HTMLElement) {
      currentElement = target;
    } else if (target instanceof Node) {
      currentElement = target.parentElement as HTMLElement | null;
    } else {
      return null;
    }

    // 遍历DOM树，检查当前元素及其所有祖先
    while (currentElement) {
      for (const key of tagKeys) {
        // 匹配标签名
        if (currentElement.tagName.toUpperCase() === key.toUpperCase()) {
          return currentElement
        }
        // 匹配类名
        if (currentElement.classList.contains(key)) {
          return currentElement
        }
        // 匹配自定义属性
        if (currentElement.hasAttribute(key)) {
          return currentElement
        }
        // 匹配data-*属性
        if (currentElement.hasAttribute(`data-${key}`)) {
          return currentElement
        }
      }

      currentElement = currentElement.parentElement as HTMLElement | null
    }

    return null
  }

  // 鼠标悬停事件
  document.addEventListener('mouseover', (e) => {
    // 如果处于编辑状态，暂时禁用鼠标悬停功能并隐藏工具栏
    if (editorState.isEditing) {
      editContainer.style.display = 'none';
      return
    }

    const target = e.target as HTMLElement
    const editableElement = findEditableTarget(target)

    if (editableElement) {
      // 移除之前高亮的元素
      if (currentHighlightedElement && currentHighlightedElement !== editableElement) {
        currentHighlightedElement.classList.remove('hover-highlight')
      }

      editableElement.classList.add('hover-highlight')
      currentHighlightedElement = editableElement

      // 定位工具栏到高亮元素的右上角
      const rect = editableElement.getBoundingClientRect()
      editContainer.style.left = `${rect.right - 100}px` // 5px 偏移量
      editContainer.style.top = `${rect.top}px`
      editContainer.style.display = 'flex' // 显示工具栏
    }
  })

  // 鼠标移出事件
  document.addEventListener('mouseout', (e) => {
    // 如果处于编辑状态，暂时禁用鼠标移出功能
    if (editorState.isEditing) {
      return
    }

    const target = e.target as HTMLElement
    const editableElement = findEditableTarget(target)

    // 检查鼠标是否移动到了工具栏上
    const isMovingToToolbar = e.relatedTarget instanceof Node && editContainer.contains(e.relatedTarget)
    if (isMovingToToolbar) {
      // 如果是移动到工具栏上，不隐藏工具栏也不移除高亮
      return
    }

    // 只有当鼠标离开整个可编辑元素（包括其子元素）时才移除高亮
    if (editableElement && e.relatedTarget && !editableElement.contains(e.relatedTarget as Node)) {
      editableElement.classList.remove('hover-highlight')
      if (currentHighlightedElement === editableElement) {
        currentHighlightedElement = null
      }
      // 隐藏工具栏
      editContainer.style.display = 'none'
    } else if (!e.relatedTarget) {
      // 鼠标离开整个文档
      if (currentHighlightedElement !== null) {
        currentHighlightedElement.classList.remove('hover-highlight')
        currentHighlightedElement = null
      }
      // 隐藏工具栏
      editContainer.style.display = 'none'
    }
  })

  // 编辑内容按钮点击事件
  editContentBtn.addEventListener('click', () => {
    const target = document.querySelector('.hover-highlight') as HTMLElement
    if (target) {
      // 隐藏工具栏按钮
      editContainer.style.display = 'none';

      // 点击编辑内容按钮时的调试日志
      if (config.debug) {
        console.log('【编辑内容】', {
          目标元素: target,
          目标元素内容: target.innerHTML
        });
      }

      startEditContent(target, sourceFiles, config.debug)
    }
  })

  // 编辑CSS按钮点击事件
  editCSSBtn.addEventListener('click', () => {
    const target = document.querySelector('.hover-highlight') as HTMLElement
    if (target) {
      // 隐藏工具栏按钮
      editContainer.style.display = 'none';

      // 点击编辑CSS按钮时的调试日志
      if (config.debug) {
        console.log('【编辑CSS】', {
          目标元素: target,
          目标元素选择器: `tagName: ${target.tagName.toLowerCase()}, class: ${target.className}`
        });
      }

      startEditCSS(target, sourceFiles, config.debug)
    }
  })
}