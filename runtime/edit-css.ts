import { createApp, defineComponent, h } from 'vue'
import VisualEditor from './components/searchResult.vue'
import matchSelectorDrawer from './components/matchSelectorDrawer.vue'

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
 * @param debug 是否启用调试日志
 */
export async function startEditCSS(element: HTMLElement, sourceFiles: string[], debug: boolean = false) {
  // 获取当前元素的CSS选择器
  const selector = generateCSSSelector(element)
  
  try {
    // 先调用查询接口，搜索CSS规则
    if (debug) {
      console.log('[easyEditor] 开始查询CSS规则:', {
        元素: element,
        选择器: selector
      })
    }
    
    const searchResponse = await fetch('/api/easy-editor/search-css', {
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
      throw new Error('查询CSS规则失败')
    }
    
    const matches: Match[] = await searchResponse.json()
    
    if (debug) {
      console.log('[easyEditor] CSS查询结果:', {
        匹配数量: matches.length
      })
    }
    
    // 根据匹配结果数量决定后续操作
    if (matches.length === 0) {
      // 未找到匹配结果
      const message = '无法编辑此元素的样式：未在源文件中找到匹配的CSS规则\n\n可能的原因：\n1. 样式可能是内联定义的\n2. 样式可能是动态生成的\n3. 选择器可能过于复杂或不唯一\n4. 源文件路径可能配置不正确'
      
      // 使用更友好的提示方式
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('编辑器提示', { body: message })
      }
      
      // 同时显示alert作为兜底
      alert(message)
      
      if (debug) {
        console.log('[easyEditor] 未找到匹配的CSS规则，详细信息：', {
          选择器: selector,
          元素标签: element.tagName.toLowerCase(),
          类名: element.className,
          ID: element.id,
          源文件: sourceFiles
        })
      }
      
      return
    } else if (matches.length === 1) {
      // 只有一个匹配结果，直接开启编辑
      if (debug) {
        console.log('[easyEditor] 找到单个CSS匹配结果，直接开启编辑')
      }
      await openCSSEditor(element, sourceFiles, selector, matches, debug)
    } else {
      // 多个匹配结果，需要用户选择
      if (debug) {
        console.log('[easyEditor] 找到多个CSS匹配结果，需要用户选择')
      }
      showMatchSelectorDrawer(matches, async (selectedIndex) => {
        await openCSSEditor(element, sourceFiles, selector, [matches[selectedIndex]], debug)
      })
    }
  } catch (error) {
    console.error('查询CSS匹配失败:', error)
    alert('查询匹配CSS规则时出错，请重试')
    
    if (debug) {
      console.log('[easyEditor] 查询CSS匹配时发生错误:', error)
    }
  }
}

/**
 * 打开CSS编辑器
 */
async function openCSSEditor(element: HTMLElement, sourceFiles: string[], selector: string, matches: Match[], debug: boolean) {
  // 创建编辑器容器
  const editorContainer = document.createElement('div')
  editorContainer.id = 'visual-editor-container'
  document.body.appendChild(editorContainer)
  
  // 创建Vue应用实例
  const app = createApp(VisualEditor, {
    modelValue: true,
    originalContent: `/* 选择器: ${selector} */
{`,
    matches: matches
  })
  
  // 监听保存事件
  app.config.globalProperties.$on('save', async (content: string, matchIndex: number) => {
    try {
      if (debug) {
        console.log('[easyEditor] 准备保存CSS内容:', {
          元素: element,
          选择器: selector,
          新内容: content,
          匹配索引: matchIndex
        });
      }
      // 搜索匹配的CSS规则
      if (debug) {
        console.log('[easyEditor] 开始搜索匹配的CSS规则:', {
          选择器: selector,
          源文件列表: sourceFiles
        });
      }
      
      const searchResponse = await fetch('/api/easy-editor/search-css', {
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
      
      if (debug) {
        console.log('[easyEditor] CSS规则搜索结果:', {
          匹配数量: matches.length,
          匹配详情: matches
        });
      }
      
      if (matches.length === 0) {
        throw new Error('未找到匹配的CSS规则')
      }
      
      // 保存CSS修改
      if (debug) {
        console.log('[easyEditor] 准备更新CSS文件:', {
          文件: matches[matchIndex].file,
          原始内容: matches[matchIndex].originalContent,
          新内容: content
        });
      }
      
      const updateResponse = await fetch('/api/easy-editor/update-css', {
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
        const errorText = await updateResponse.text();
        throw new Error(`保存CSS失败: ${updateResponse.statusText} ${errorText}`)
      }
      
      if (debug) {
        console.log('[easyEditor] CSS保存成功:', {
          文件: matches[matchIndex].file,
          更新状态: '成功'
        });
      }
      
      // 更新成功后刷新页面
      window.location.reload()
      
    } catch (error) {
      console.error('编辑CSS失败:', error)
      alert('编辑CSS失败，请检查控制台日志')
      
      if (debug) {
        console.log('[easyEditor] CSS编辑过程中发生错误:', error);
      }
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
// 显示匹配选择抽屉
function showMatchSelectorDrawer(matches: Match[], onSelect: (index: number) => void) {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const app = createApp(defineComponent({
    render() {
      return h(matchSelectorDrawer, {
        isVisible: true,
        title: '选择要修改的CSS规则',
        matches,
        direction: 'right',
        onClose: () => {
          app.unmount()
          document.body.removeChild(container)
        },
        onSelect: (index: number) => {
          onSelect(index)
          app.unmount()
          document.body.removeChild(container)
        }
      })
    }
  }))

  app.mount(container)
}

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