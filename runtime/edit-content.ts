// visual-editor-content.ts

import { editorState, generateContentVariants } from './index'
import { createApp, defineComponent, h } from 'vue'
import searchResult from './components/searchResult.vue'

/**
 * 内容匹配结果接口
 */
export interface ContentMatch {
  file: string;
  line: number;
  context: string;
  originalContent: string;
}

/**
 * 开始编辑内容
 * @param element 要编辑的DOM元素
 * @param sourceFiles 源文件列表
 * @param debug 是否启用调试日志
 */
export async function startEditContent(element: HTMLElement, sourceFiles: string[], debug: boolean = false) {
  // 检查元素是否存在
  if (!element) return

  // 保存原始内容，用于取消操作
  // 移除 Vue 生成的 data-v-xxxxxx 属性后再保存原始内容
  const originalContent = element.innerHTML.replace(/\s*data-v-[a-z0-9]{8}(="[^"]*")?/g, '')
  // 生成内容变体
  const variantsContent = generateContentVariants(originalContent)

  try {
    // 先调用查询接口，搜索内容在源文件中的位置
    if (debug) {
      console.log('【准备查询】', {
        A目标元素: element,
        B原始内容: originalContent,
        C内容变体: variantsContent,
        D文件列表: sourceFiles
      })
    }

    let foundMatches = false;

    // 使用for...of循环正确处理异步操作
    let matchedVariant: string | null = null;

    for (const variant of variantsContent) {
      // if (debug) {
      //   console.log('【尝试匹配变体内容】', variant.substring(0, 50) + (variant.length > 50 ? '...' : ''))
      // }

      const searchResponse = await fetch('/api/easy-editor/search-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: variant,
          files: sourceFiles,
        })
      })

      console.log(searchResponse);
      if (!searchResponse.ok) {
        // 不抛出错误，继续尝试下一个变体
        continue;
      }

      const matches: ContentMatch[] = await searchResponse.json()

      console.log(matches);
      if (debug) {
        console.log('【查询结果】', {
          匹配数量: matches.length,
          匹配详情: matches.map(m => ({ file: m.file, line: m.line, contentLength: m.originalContent.length }))
        })
      }

      // 如果找到匹配结果
      if (matches.length > 0) {
        foundMatches = true;
        matchedVariant = variant; // 保存匹配成功的变体

        if (debug) {
          console.log('找到匹配结果，使用变体:', '['+matchedVariant.substring(0, 50) + (matchedVariant.length > 50 ? '...' : '')+']')
        }

        if (matches.length === 1) {
          // 只有一个匹配结果，直接开启编辑
          await openEditor(element, sourceFiles, originalContent, debug, 0, matchedVariant)
        } else {
          // 多个匹配结果，需要用户选择
          // 显示搜索结果选择器
          showSearchResultSelector(matches, async (selectedIndex) => {
            await openEditor(element, sourceFiles, originalContent, debug, selectedIndex, matchedVariant)
          })
        }

        // 找到匹配后退出循环
        break;
      }
    }

    // 如果所有变体都未找到匹配结果
    if (!foundMatches) {
      // 未找到匹配结果
      const message = '无法编辑此内容：未在源文件中找到匹配项\n\n可能的原因：\n1. 内容可能是动态生成的\n2. 内容可能已被修改但未保存\n3. 源文件路径可能配置不正确'

      // 使用更友好的提示方式
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('编辑器提示', { body: message })
      }

      // 同时显示alert作为兜底
      alert(message)

      if (debug) {
        console.log('[easyEditor] 未找到匹配结果，详细信息：', {
          元素标签: element.tagName,
          元素ID: element.id,
          元素类名: element.className,
          内容片段: originalContent.substring(0, 100) + '...',
          源文件: sourceFiles,
          尝试变体数量: variantsContent.length
        })
      }
    }
  } catch (error) {
    console.error('查询内容匹配失败:', error)
    alert('查询匹配内容时出错，请重试')

    if (debug) {
      console.log('[easyEditor] 查询内容匹配时发生错误:', error)
    }
  }
}

/**
 * 打开编辑器
 */
async function openEditor(element: HTMLElement, sourceFiles: string[], originalContent: string, debug: boolean, selectedIndex: number = 0, matchedVariant: string | null = null) {
  // 保存原始样式，用于恢复
  const originalStyle = element.style.cssText

  // 创建编辑工具栏
  const editToolbar = document.createElement('div')
  editToolbar.className = 'content-edit-toolbar'
  editToolbar.innerHTML = `
    <button class="content-edit-save">保存</button>
    <button class="content-edit-cancel">取消</button>
  `

  // 设置元素为可编辑
  element.setAttribute('contenteditable', 'true')

  // 添加编辑模式样式类
  element.classList.add('content-editable-active')

  // 编辑工具栏使用CSS类名，不再使用内联样式
  editToolbar.classList.add('content-edit-toolbar')

  // 添加ARIA属性以提高可访问性
  element.setAttribute('aria-label', '可编辑内容区域')
  element.setAttribute('role', 'textbox')

  // 将工具栏添加到页面并定位
  document.body.appendChild(editToolbar)
  positionToolbar(editToolbar, element)

  // 获取工具栏按钮
  const saveBtn = editToolbar.querySelector('.content-edit-save') as HTMLButtonElement
  const cancelBtn = editToolbar.querySelector('.content-edit-cancel') as HTMLButtonElement

  // 自动聚焦到可编辑元素
  element.focus()

  // 设置编辑器状态为编辑中
  editorState.isEditing = true

  // 保存按钮点击事件
  saveBtn.addEventListener('click', async () => {
    // 保存原始内容和匹配成功的变体到元素的data属性中
    element.setAttribute('data-original-content', originalContent);
    if (matchedVariant) {
      element.setAttribute('data-matched-variant', matchedVariant);
      if (debug) {
        console.log('[easyEditor] 保存匹配变体到元素属性:', matchedVariant.substring(0, 50) + (matchedVariant.length > 50 ? '...' : ''));
      }
    }
    await saveContent(element, sourceFiles, editToolbar, originalStyle, debug)
  })

  // 取消按钮点击事件
  cancelBtn.addEventListener('click', () => {
    cleanupEdit(element, editToolbar, originalContent, originalStyle)
  })

  // ESC键取消编辑
  element.addEventListener('keydown', handleKeydown)

  // 点击文档其他地方关闭编辑（可选）
  document.addEventListener('click', handleDocumentClick)

  // 窗口大小改变时重新定位工具栏
  window.addEventListener('resize', handleResize)

  // 处理窗口大小改变
  function handleResize() {
    positionToolbar(editToolbar, element)
  }

  // 处理键盘事件
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      cleanupEdit(element, editToolbar, originalContent, originalStyle)
    }
  }

  // 处理文档点击
  function handleDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (!element.contains(target) && !editToolbar.contains(target)) {
      // 可以注释掉这一行，让用户必须显式点击保存或取消
      // cleanupEdit(element, editToolbar, originalContent, originalStyle)
    }
  }
}

/**
 * 定位工具栏到元素的右上角
 */
function positionToolbar(toolbar: HTMLElement, element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  toolbar.style.left = `${rect.right + 10}px`
  toolbar.style.top = `${rect.top}px`
}

/**
 * 保存编辑内容
 */
async function saveContent(
  element: HTMLElement,
  sourceFiles: string[],
  toolbar: HTMLElement,
  originalStyle: string,
  debug: boolean = false
) {
  const newContent = element.innerHTML

  try {
    // 优先使用匹配成功的变体作为替换的旧内容
    // 在startEditContent阶段已经完成了内容匹配，不需要再次调用search-content API
    const oldContentForReplacement = element.getAttribute('data-matched-variant') || element.getAttribute('data-original-content') || element.innerHTML;
    
    if (debug) {
      console.log('【保存内容】', {
        目标元素: element,
        替换内容: oldContentForReplacement.substring(0, 50) + (oldContentForReplacement.length > 50 ? '...' : ''),
        新内容: newContent.substring(0, 50) + (newContent.length > 50 ? '...' : '')
      });
      console.log('【保存内容】使用匹配变体:', !!element.getAttribute('data-matched-variant'));
    }

    // 发送更新内容请求
    const response = await fetch('/api/easy-editor/update-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: sourceFiles,
        content: {
          old: oldContentForReplacement,
          new: newContent
        }
      })
    })

    // 解析响应体，获取更新结果
    const result = await response.json();

    if (response.ok && result.success) {
      // 恢复元素状态
      element.removeAttribute('contenteditable')
      element.classList.remove('content-editable-active')
      element.style.cssText = originalStyle
      element.removeAttribute('aria-label')
      element.removeAttribute('role')

      // 移除工具栏
      toolbar.remove()

      // 移除事件监听
      cleanupEventListeners(element, toolbar)

      if (debug) {
        console.log('【保存内容】保存内容成功:', {
          更新的文件: result.updatedFiles,
          原始内容: oldContentForReplacement,
          新内容: newContent
        });
      }

      // 提示用户保存成功
      if (result.updatedFiles && result.updatedFiles.length > 0) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('编辑器', { body: `内容已成功更新到 ${result.updatedFiles.length} 个文件中` });
        }
      } else {
        console.warn('[easyEditor] 未更新任何文件，可能是内容未发生变化或未在源文件中找到匹配');
      }
    } else {
      const errorMsg = result.error || '保存失败，请重试';
      console.error('更新内容失败:', errorMsg)
      alert(`保存失败: ${errorMsg}`)

      if (debug) {
        console.log('[easyEditor] 保存内容失败:', {
          状态码: response.status,
          响应结果: result
        });
      }
    }
  } catch (error) {
    console.error('更新内容时出错:', error)
    alert('保存过程中出错，请重试')

    if (debug) {
      console.log('[Visual Editor] 保存内容时发生异常:', error);
    }
  } finally {
    // 设置编辑器状态为非编辑中
    editorState.isEditing = false;
    // 重新显示编辑器工具栏
    const editContainer = document.querySelector('.visual-editor-toolbar');
    if (editContainer) {
      editContainer.style.display = 'none'; // 初始设置为隐藏，等待鼠标悬停时再显示
    }
  }
}

/**
 * 清理编辑状态
 */
function cleanupEdit(
  element: HTMLElement,
  toolbar: HTMLElement,
  originalContent: string,
  originalStyle: string
) {
  // 恢复原始内容
  element.innerHTML = originalContent

  // 恢复元素状态
  element.removeAttribute('contenteditable')
  element.classList.remove('content-editable-active')
  element.style.cssText = originalStyle
  element.removeAttribute('aria-label')
  element.removeAttribute('role')

  // 移除工具栏
  toolbar.remove()

  // 移除事件监听
  cleanupEventListeners(element, toolbar)

  // 设置编辑器状态为非编辑中
  editorState.isEditing = false;
  // 重新显示编辑器工具栏
  const editContainer = document.querySelector('.visual-editor-toolbar');
  if (editContainer) {
    editContainer.style.display = 'none'; // 初始设置为隐藏，等待鼠标悬停时再显示
  }
}

/**
 * 清理事件监听器
 */
function cleanupEventListeners(element: HTMLElement, toolbar: HTMLElement) {
  // 使用命名函数可以更精确地移除事件监听器
  element.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('resize', handleResize)

  function handleKeydown(e: KeyboardEvent) { }
  function handleDocumentClick(e: MouseEvent) { }
  function handleResize() { }
}

/**
 * 显示搜索结果选择器
 */
function showSearchResultSelector(matches: ContentMatch[], onSelect: (index: number) => void) {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const app = createApp(defineComponent({
    render() {
      return h(searchResult, {
        isVisible: true,
        title: '选择要修改的位置',
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