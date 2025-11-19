import { createApp } from 'vue'
import VisualEditor from './components/VisualEditor.vue'

interface Match {
  file: string
  line: number
  context: string
  originalContent: string
}

/**
 * CSS编辑入口函数
 * @param element 要编辑的DOM元素
 * @param sourceFiles 源文件列表
 */
export function startEditCSS(element: HTMLElement, sourceFiles: string[]) {
  // 获取当前元素的CSS选择器
  const selector = generateCSSSelector(element)
  
  // 创建编辑器容器
  const editorContainer = document.createElement('div')
  editorContainer.id = 'visual-editor-container'
  document.body.appendChild(editorContainer)
  
  // 创建Vue应用实例
  const app = createApp(VisualEditor, {
    modelValue: true,
    originalContent: `/* 选择器: ${selector} */
{`,
    matches: []
  })
  
  // 监听保存事件
  app.config.globalProperties.$on('save', async (content: string, matchIndex: number) => {
    try {
      // 搜索匹配的CSS规则
      const searchResponse = await fetch('/api/visual-editor/search-css', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          selector,
          sourceFiles
        })
      })
      
      if (!searchResponse.ok) {
        throw new Error('搜索CSS规则失败')
      }
      
      const matches: Match[] = await searchResponse.json()
      
      if (matches.length === 0) {
        throw new Error('未找到匹配的CSS规则')
      }
      
      // 保存CSS修改
      const updateResponse = await fetch('/api/visual-editor/update-css', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file: matches[matchIndex].file,
          originalContent: matches[matchIndex].originalContent,
          newContent: content
        })
      })
      
      if (!updateResponse.ok) {
        throw new Error('保存CSS失败')
      }
      
      // 更新成功后刷新页面
      window.location.reload()
      
    } catch (error) {
      console.error('编辑CSS失败:', error)
      alert('编辑CSS失败，请检查控制台日志')
    } finally {
      // 销毁编辑器应用
      app.unmount()
      document.body.removeChild(editorContainer)
    }
  })
  
  // 监听取消事件
  app.config.globalProperties.$on('cancelEdit', () => {
    app.unmount()
    document.body.removeChild(editorContainer)
  })
  
  // 挂载编辑器
  app.mount(editorContainer)
}

/**
 * 生成CSS选择器
 * @param element DOM元素
 * @returns CSS选择器字符串
 */
export function generateCSSSelector(element: HTMLElement): string {
  const selectors: string[] = []
  let currentElement: HTMLElement | null = element
  
  while (currentElement && currentElement.tagName !== 'HTML') {
    let selector = currentElement.tagName.toLowerCase()
    
    // 添加类名
    if (currentElement.classList.length > 0) {
      const classes = Array.from(currentElement.classList)
      selector += '.' + classes.join('.')
    }
    
    // 添加ID
    if (currentElement.id) {
      selector += `#${currentElement.id}`
    }
    
    // 添加伪类来提高特异性（可选）
    // 这里简单地添加一个伪类表示位置
    const parent = currentElement.parentElement
    if (parent) {
      const siblings = Array.from(parent.children) as HTMLElement[]
      const index = siblings.indexOf(currentElement)
      if (index > 0) {
        selector += `:nth-child(${index + 1})`
      }
    }
    
    selectors.unshift(selector)
    currentElement = currentElement.parentElement
  }
  
  // 加入HTML前缀以确保选择器完整
  selectors.unshift('html')
  
  return selectors.join(' > ')
}