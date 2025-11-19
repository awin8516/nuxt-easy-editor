// visual-editor-content.ts

import { generateCSSSelector } from './visual-editor-css'

/**
 * 开始编辑内容
 * @param element 要编辑的DOM元素
 * @param sourceFiles 源文件列表
 */
export function startEditContent(element: HTMLElement, sourceFiles: string[]) {
  // 检查元素是否存在
  if (!element) return

  // 创建编辑器容器
  const editorContainer = document.createElement('div')
  editorContainer.classList.add('visual-editor-modal')

  // 构建编辑器HTML结构
  editorContainer.innerHTML = `
    <div class="visual-editor-modal-backdrop"></div>
    <div class="visual-editor-modal-content">
      <div class="visual-editor-modal-header">
        <h2>编辑内容</h2>
        <button class="visual-editor-modal-close">×</button>
      </div>
      <div class="visual-editor-modal-body">
        <label for="content-input">内容:</label>
        <textarea id="content-input" class="visual-editor-content-input" rows="10"></textarea>
      </div>
      <div class="visual-editor-modal-footer">
        <button class="visual-editor-btn visual-editor-btn-cancel">取消</button>
        <button class="visual-editor-btn visual-editor-btn-save">保存</button>
      </div>
    </div>
  `

  // 添加到页面
  document.body.appendChild(editorContainer)

  // 获取编辑器元素
  const contentInput = editorContainer.querySelector('#content-input') as HTMLTextAreaElement
  const saveBtn = editorContainer.querySelector('.visual-editor-btn-save') as HTMLButtonElement
  const cancelBtn = editorContainer.querySelector('.visual-editor-btn-cancel') as HTMLButtonElement
  const closeBtn = editorContainer.querySelector('.visual-editor-modal-close') as HTMLButtonElement
  const backdrop = editorContainer.querySelector('.visual-editor-modal-backdrop') as HTMLDivElement

  // 设置初始内容
  contentInput.value = element.innerHTML

  // 保存事件处理
  saveBtn.addEventListener('click', async () => {
    const newContent = contentInput.value
    const selector = generateCSSSelector(element)

    try {
      const response = await fetch('/api/update-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          files: sourceFiles,
          content: {
            old: element.innerHTML,
            new: newContent,
            selector: selector
          }
        })
      })

      if (response.ok) {
        // 更新DOM
        element.innerHTML = newContent
        // 关闭编辑器
        document.body.removeChild(editorContainer)
      } else {
        console.error('更新内容失败:', response.statusText)
      }
    } catch (error) {
      console.error('更新内容时出错:', error)
    }
  })

  // 取消事件处理
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(editorContainer)
  })

  // 关闭按钮事件处理
  closeBtn.addEventListener('click', () => {
    document.body.removeChild(editorContainer)
  })

  // 点击背景关闭编辑器
  backdrop.addEventListener('click', () => {
    document.body.removeChild(editorContainer)
  })

  // 自动聚焦输入框
  contentInput.focus()
}