// visual-editor-content.ts

import { editorState } from './index'
import { createApp, defineComponent, h, ref } from 'vue'
import searchResult from './components/searchResult.vue'

// 全局编辑状态存储，替代元素属性存储
interface EditState {
  originalContent: string;
  matchedVariant?: string;
  selectedMatch?: ContentMatch;
  originalStyle?: string;
}

// 全局Map存储每个元素的编辑状态，使用元素唯一标识作为键
const editStates = new Map<string, EditState>();

// 获取元素的唯一标识符（用于Map的键）
function getElementKey(element: HTMLElement): string {
  // 使用元素的位置和创建时间作为唯一标识
  return `${element.tagName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 根据DOM元素生成DOM路径
 * @param targetElement 目标DOM元素
 * @returns DOM路径字符串
 */
export function findElementByDomPath(targetElement: HTMLElement): string {
  // 构建DOM路径
  const pathSegments: string[] = [];
  let current: HTMLElement | null = targetElement;
  
  // 最多向上查找10层，避免循环引用和性能问题
  let depth = 0;
  const maxDepth = 10;
  
  while (current && !pathSegments.includes('html') && depth < maxDepth) {
    const segment = [];
    
    // 优先使用ID
    if (current.id) {
      segment.push(`#${current.id}`);
    }
    
    // 添加类名（限制数量以避免路径过长）
    if (current.className && current.className.trim()) {
      const classes = current.className.split(' ')
        .filter(c => c.trim()) // 过滤空类名
        .slice(0, 3) // 最多取3个类名
        .map(c => `.${c}`)
        .join('');
      if (classes) segment.push(classes);
    }
    
    // 添加标签名
    segment.push(current.tagName.toLowerCase());
    
    // 添加位置索引（同层级相同选择器时需要）
    const siblings = Array.from(current.parentNode?.children || [])
      .filter(child => child instanceof HTMLElement && 
                       child.tagName === current.tagName && 
                       child.id === current.id && 
                       child.className === current.className);
    
    if (siblings.length > 1) {
      const index = siblings.indexOf(current);
      segment.push(`:nth-child(${index + 1})`);
    }
    
    pathSegments.push(segment.join(''));
    current = current.parentNode as HTMLElement | null;
    depth++;
  }
  
  return pathSegments.reverse().join(' > ');
}

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
 * 开始编辑内容的入口函数
 * @param element 目标元素
 * @param sourceFiles 源文件路径数组
 * @param debug 是否启用调试日志
 */
export async function startEditContent(element: HTMLElement, sourceFiles: string[], debug: boolean = false) {
  // 检查元素和参数有效性
  if (!element || !sourceFiles || !Array.isArray(sourceFiles)) {
    console.error('无效的参数: 需要提供有效的元素和源文件列表');
    return;
  }

  // 检查元素是否已经在编辑中
  if (editorState.isEditing) {
    console.warn('已有元素在编辑中，请先完成当前编辑');
    return;
  }

  // 保存原始内容，用于取消操作
  // 移除 Vue 生成的 data-v-xxxxxx 属性后再保存原始内容
  const originalContent = element.innerHTML.replace(/\s*data-v-[a-z0-9]{8}(="[^"]*")?/g, '')
  
  // 获取元素的DOM路径
  const domPath = findElementByDomPath(element)
  
  // 获取元素ID
  const elementId = element.id;

  try {
    // 调用search-content接口进行内容匹配
    // 内容变体匹配逻辑已在服务器端实现
    const searchResponse = await fetch('/api/easy-editor/search-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: originalContent,
        sourceFiles,
        domPath,
        elementId
      })
    })

    if (!searchResponse.ok) {
      throw new Error(`HTTP error! status: ${searchResponse.status}`)
    }

    const searchResult = await searchResponse.json()
    const matches = searchResult.matches || []
    console.log('matches', matches)

    // 根据匹配结果处理
    if (matches.length === 1) {
      // 单个匹配结果，直接在原始目标元素上使用contenteditable属性开启编辑
      await openEditor(element, sourceFiles, originalContent, debug, 0, originalContent, matches[0])
    } else if (matches.length > 1) {
      // 多个匹配结果，调用抽屉插件显示多个匹配结果供用户选择
      showSearchResultSelector(matches, async (selectedIndex) => {
        await openEditor(element, sourceFiles, originalContent, debug, selectedIndex, originalContent, matches[selectedIndex])
      })
    } else {
      throw new Error('未找到匹配内容，无法开启编辑模式')
    }
  } catch (error) {
    throw error;
  }
}

/**
 * 打开编辑器
 */
async function openEditor(element: HTMLElement, sourceFiles: string[], originalContent: string, debug: boolean, selectedIndex: number = 0, matchedVariant: string | null = null, selectedMatch?: ContentMatch) {
  // 保存原始样式，用于恢复
  const originalStyle = element.style.cssText;
  
  // 为元素生成唯一键并存储到全局Map
  const elementKey = getElementKey(element);
  element.setAttribute('data-element-key', elementKey); // 临时存储键用于后续查找
  
  // 创建并存储编辑状态到全局Map
  editStates.set(elementKey, {
    originalContent,
    matchedVariant: matchedVariant || undefined,
    selectedMatch,
    originalStyle
  });
  
  if (debug) {
    console.log('[easyEditor] 为元素创建编辑状态:', elementKey);
  }

  // 创建编辑工具栏
  const editToolbar = document.createElement('div')
  editToolbar.className = 'content-edit-toolbar'
  editToolbar.innerHTML = `
    <button class="content-edit-save">保存</button>
    <button class="content-edit-cancel">取消</button>
  `

  // 设置元素为可编辑（直接在原始元素上使用contenteditable属性）
  element.setAttribute('contenteditable', 'true')

  // 添加编辑模式样式类
  element.classList.add('content-editable-active')

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
    // 注意：编辑状态已在openEditor函数中存储到全局Map，不需要再保存到元素属性
    // 直接调用保存函数
    await saveContent(element, sourceFiles, editToolbar, originalStyle, debug, selectedMatch)
  })

  // 取消按钮点击事件
  cancelBtn.addEventListener('click', () => {
    cleanupEdit(element, editToolbar, originalContent, originalStyle)
  })

  // ESC键取消编辑
  element.addEventListener('keydown', handleKeydown)

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
}

/**
 * 定位工具栏到元素的右上角
 */
function positionToolbar(toolbar: HTMLElement, element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  toolbar.style.left = `${rect.right + 10}px`
  toolbar.style.top = `${rect.top}px`
}

// 导出必要的类型定义供其他模块使用
export { ContentMatch }

/**
 * 保存编辑内容到源文件
 * @param element 编辑的元素
 * @param sourceFiles 源文件路径数组
 * @param toolbar 工具栏元素
 * @param originalStyle 原始样式
 * @param debug 是否启用调试日志
 * @param selectedMatch 用户选择的单个匹配结果
 */
async function saveContent(element: HTMLElement, sourceFiles: string[], toolbar: HTMLElement, originalStyle: string, debug: boolean = false, selectedMatch?: ContentMatch) {
  try {
    // 获取新内容
    const newContent = element.innerHTML;
    
    // 从全局Map获取元素的编辑状态
    const elementKey = element.getAttribute('data-element-key');
    const editState = elementKey ? editStates.get(elementKey) : null;
    
    // 确定用于替换的旧内容（使用匹配的原始内容或元素的原始内容）
    // 优先使用全局存储中的内容，其次回退到直接获取
    const oldContentForReplacement = editState?.matchedVariant || editState?.originalContent || element.innerHTML;
    
    // 检查内容是否有变化
    if (newContent === oldContentForReplacement) {
      // 内容未变化，直接取消编辑
        console.log("【保存失败】内容未变化，无需保存。");
        // 从全局Map获取原始内容
        const elementKey = element.getAttribute('data-element-key');
        const editState = elementKey ? editStates.get(elementKey) : null;
        cleanupEdit(element, toolbar, editState?.originalContent || newContent, originalStyle);

      return;
    }

    // 确定要使用的文件路径 - 优先使用选中的匹配结果中的文件路径
    const filePath = selectedMatch ? [selectedMatch.file] : sourceFiles;
    
    // 准备API请求数据，包含行号信息
    const requestBody = {
      files: filePath, // 只传递选中的单个匹配结果的文件路径
      content: {
        old: oldContentForReplacement,
        new: newContent
      }
    };
    
    // 如果有选中的匹配结果，添加行号信息
    if (selectedMatch && selectedMatch.line) {
      requestBody.line = selectedMatch.line;
    }
    
    // 调用update-content接口保存内容
    const response = await fetch('/api/easy-editor/update-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    // 解析响应体，获取更新结果
    let result;
    try {
      result = await response.json();
    } catch (jsonError) {
      throw new Error(`【保存失败】无效的响应格式: ${jsonError.message}`);
    }

    if (response.ok && result.success) {
      // 恢复元素状态
      element.removeAttribute('contenteditable');
      element.classList.remove('content-editable-active');
      element.style.cssText = originalStyle;
      element.removeAttribute('aria-label');
      element.removeAttribute('role');

      // 移除工具栏
      toolbar.remove();

      // 移除事件监听
      cleanupEventListeners(element, toolbar);

      // 保存成功

      // 触发内容更新事件，通知其他组件内容已更新
      window.dispatchEvent(new CustomEvent('easy-editor:content-updated', {
        detail: {
          updatedFiles: result.updatedFiles,
          success: true
        }
      }));

      // 提示用户保存成功
      if (result.updatedFiles && result.updatedFiles.length > 0) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('编辑器', { body: `内容已成功更新到 ${result.updatedFiles.length} 个文件中` });
        }
      }
    } else {
      const errorMsg = result.error || `保存失败: HTTP ${response.status}`;
      alert(`保存失败: ${errorMsg}`);

      // 触发保存失败事件
      window.dispatchEvent(new CustomEvent('easy-editor:save-error', {
        detail: { error: errorMsg }
      }));

      // 保存失败
    }
  } catch (error: any) {
    alert(error.message || '保存过程中出错，请重试');

    // 触发保存失败事件
    window.dispatchEvent(new CustomEvent('easy-editor:save-error', {
      detail: { error: error.message || '未知错误' }
    }));

    // 发生异常
  } finally {
    // 设置编辑器状态为非编辑中
    editorState.isEditing = false;
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
  // 从全局Map删除编辑状态
  const elementKey = element.getAttribute('data-element-key');
  if (elementKey) {
    editStates.delete(elementKey);
  }

  // 恢复原始内容
  element.innerHTML = originalContent;
  
  // 恢复原始样式
  element.style.cssText = originalStyle;

  // 移除编辑相关的属性
  element.removeAttribute('contenteditable');
  element.classList.remove('content-editable-active');
  element.removeAttribute('data-element-key'); // 移除临时存储的键
  element.removeAttribute('role');
  element.removeAttribute('aria-label');

  // 移除工具栏
  toolbar.remove();

  // 移除事件监听
  cleanupEventListeners(element, toolbar);

  // 设置编辑器状态为非编辑中
  editorState.isEditing = false;
}

/**
 * 清理事件监听器
 */
function cleanupEventListeners(element: HTMLElement, toolbar: HTMLElement) {
  // 使用命名函数可以更精确地移除事件监听器
  element.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('resize', handleResize)

  // 定义空函数用于移除事件监听
  function handleKeydown(e: KeyboardEvent) { }
  function handleDocumentClick(e: MouseEvent) { }
  function handleResize() { }
}

/**
 * 显示搜索结果选择器（多个匹配结果时调用抽屉插件）
 */
function showSearchResultSelector(matches: ContentMatch[], onSelect: (index: number) => void) {
  // 直接使用Vue创建并挂载searchResult组件，不依赖事件机制
  try {
    // 创建挂载容器
    const container = document.createElement('div');
    document.body.appendChild(container);
    
    // 创建Vue应用实例并挂载组件
    const app = createApp(defineComponent({
      components: {
        searchResult
      },
      setup() {
        const isVisible = ref(true);
        const title = ref('选择编辑内容');
        
        const handleClose = () => {
          app.unmount();
          container.remove();
        };
        
        const handleSelect = (index: number) => {
          onSelect(index);
          app.unmount();
          container.remove();
        };
        
        return {
          isVisible,
          title,
          matches,
          handleClose,
          handleSelect
        };
      },
      render() {
        return h(searchResult, {
          isVisible: this.isVisible,
          title: this.title,
          matches: this.matches,
          direction: 'right',
          onClose: this.handleClose,
          onSelect: this.handleSelect
        });
      }
    }));
    
    app.mount(container);
  } catch (error) {
    console.error('抽屉插件加载失败，使用备用方案', error);
    // 降级方案：使用简单的模态框（备用方案）
    
    // 创建临时容器
    const container = document.createElement('div');
    container.className = 'search-result-selector';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // 创建选择器主体
    const selector = document.createElement('div');
    selector.className = 'search-result-selector__content';
    selector.style.cssText = `
      background: white;
      padding: 20px;
      border-radius: 8px;
      width: 80%;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
    `;

    // 创建标题
    const title = document.createElement('h3');
    title.textContent = `找到 ${matches.length} 个匹配结果，请选择要编辑的内容`;
    title.style.marginBottom = '20px';
    selector.appendChild(title);

    // 创建结果列表
    const resultList = document.createElement('ul');
    resultList.className = 'search-result-selector__list';
    resultList.style.listStyle = 'none';
    resultList.style.padding = '0';
    resultList.style.margin = '0';

    // 添加匹配结果项
    matches.forEach((match, index) => {
      const item = document.createElement('li');
      item.className = 'search-result-selector__item';
      item.style.cssText = `
        padding: 15px;
        margin-bottom: 10px;
        border: 1px solid #eee;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
      `;
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#f5f5f5';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'white';
      });

      // 文件信息
      const fileInfo = document.createElement('div');
      fileInfo.className = 'search-result-selector__file';
      fileInfo.textContent = `文件: ${match.file} (行: ${match.line})`;
      fileInfo.style.fontWeight = 'bold';
      fileInfo.style.marginBottom = '5px';

      // 内容预览
      const preview = document.createElement('div');
      const previewText = match.originalContent.substring(0, 100) + (match.originalContent.length > 100 ? '...' : '');
      preview.className = 'search-result-selector__preview';
      preview.textContent = previewText;
      preview.style.fontSize = '14px';
      preview.style.color = '#666';
      preview.style.fontFamily = 'monospace';

      item.appendChild(fileInfo);
      item.appendChild(preview);
      item.addEventListener('click', () => {
        onSelect(index);
        document.body.removeChild(container);
      });
      resultList.appendChild(item);
    });

    selector.appendChild(resultList);
    container.appendChild(selector);
    document.body.appendChild(container);

    // 点击背景关闭
    container.addEventListener('click', (e) => {
      if (e.target === container) {
        document.body.removeChild(container);
      }
    });

    // 按ESC键关闭
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.body.removeChild(container);
        document.removeEventListener('keydown', handleEsc);
      }
    };
    document.addEventListener('keydown', handleEsc);
  }
}