// visual-editor-content.ts

import { editorState } from './index'
import { createApp, defineComponent, h } from 'vue'
import searchResult from './components/searchResult.vue'

/**
 * 匹配结果接口
 */
export interface MatchResult {
  score: number;
  start: number;
  end: number;
  variantIndex: number;
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
 * 基于ID的快速匹配函数
 * @param domPath 元素的DOM路径
 * @param fileContent 文件内容
 * @param fileType 文件类型
 * @returns 匹配结果或null
 */
export function matchById(domPath: string, fileContent: string, fileType: string): MatchResult | null {
  // 从DOM路径中提取ID
  const idMatch = domPath.match(/#([a-z][\w-]*)/i);
  if (!idMatch) return null;
  
  const elementId = idMatch[1];
  
  // Vue文件特殊处理
  if ((fileType === 'vue' || fileType === '.vue')) {
    const templateMatch = fileContent.match(/<template[\s\S]*?>([\s\S]*?)<\/template>/);
    if (templateMatch) {
      const templateContent = templateMatch[1];
      // 构建ID选择器正则表达式，考虑多种引号情况
      const idRegex = new RegExp(
        `<([a-z][a-z0-9:-]*)[^>]*id=["']${elementId}["'][^>]*>`, 
        'gi'
      );
      
      let match;
      let bestMatch: MatchResult | null = null;
      
      while ((match = idRegex.exec(templateContent)) !== null) {
        const start = templateMatch.index + 1 + match.index; // 考虑<template>标签的长度
        const end = start + match[0].length;
        
        // 设置高匹配分数（0.95）
        const currentMatch: MatchResult = {
          score: 0.95,
          start,
          end,
          variantIndex: 0
        };
        
        // 如果没有最佳匹配或当前匹配更好，更新最佳匹配
        if (!bestMatch || currentMatch.score > bestMatch.score) {
          bestMatch = currentMatch;
        }
      }
      
      return bestMatch;
    }
  }
  
  // 通用ID匹配（适用于HTML等文件）
  const idRegex = new RegExp(
    `<([a-z][a-z0-9:-]*)[^>]*id=["']${elementId}["'][^>]*>`, 
    'gi'
  );
  
  let match;
  let bestMatch: MatchResult | null = null;
  
  while ((match = idRegex.exec(fileContent)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    
    const currentMatch: MatchResult = {
      score: 0.9,
      start,
      end,
      variantIndex: 0
    };
    
    if (!bestMatch || currentMatch.score > bestMatch.score) {
      bestMatch = currentMatch;
    }
  }
  
  return bestMatch;
}

/**
 * 基于DOM结构匹配元素在文件中的位置
 * @param domPath 元素的DOM路径
 * @param fileContent 文件内容
 * @param fileType 文件类型
 * @returns 匹配结果或null
 */
export function matchByDomStructure(domPath: string, fileContent: string, fileType: string): MatchResult | null {
  // 解析DOM路径为段
  const pathSegments = domPath.split('\u003e').map(segment => segment.trim()).filter(Boolean);
  
  // Vue文件特殊处理
  let contentToSearch = fileContent;
  if ((fileType === 'vue' || fileType === '.vue')) {
    const templateMatch = fileContent.match(/\u003ctemplate[\s\S]*?\u003e([\s\S]*?)\u003c\/template\u003e/);
    if (templateMatch) {
      contentToSearch = templateMatch[1];
    }
  }
  
  // 尝试从DOM路径构建正则表达式进行匹配
  const bestMatch = findBestStructuralMatch(pathSegments, contentToSearch, fileType);
  
  if (bestMatch) {
    return bestMatch;
  }
  
  // 如果完整路径匹配失败，尝试匹配路径的子集（从末尾开始）
  for (let i = 1; i < pathSegments.length - 1; i++) {
    const partialPath = pathSegments.slice(i);
    const partialMatch = findBestStructuralMatch(partialPath, contentToSearch, fileType);
    if (partialMatch) {
      // 部分匹配的分数较低
      partialMatch.score = 0.7 - (i * 0.1);
      return partialMatch;
    }
  }
  
  return null;
}

/**
 * 查找最佳的结构匹配
 */
function findBestStructuralMatch(pathSegments: string[], content: string, fileType: string): MatchResult | null {
  // 针对每个路径段构建正则表达式部分
  const regexParts: string[] = [];
  
  // 跳过html和body段，它们在模板中可能不存在
  const relevantSegments = pathSegments.filter(segment => segment !== 'html' && segment !== 'body');
  
  if (relevantSegments.length === 0) return null;
  
  // 为每个相关段构建正则表达式
  for (const segment of relevantSegments) {
    let part = segment;
    
    // 转义正则特殊字符
    part = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // 处理ID选择器
    part = part.replace(/#([a-z][\w-]*)/i, '(?:id=["\']$1["\']|id=$1)');
    
    // 处理类选择器（转换为可选条件）
    part = part.replace(/\.([a-z][\w-]*)/gi, '(?:class=["\'](?:.*\\s)?$1(?:\\s.*)?["\']|class=(?:.*\\s)?$1(?:\\s.*)?)');
    
    // 移除:nth-child选择器（在匹配模板时不太适用）
    part = part.replace(/:nth-child\(\d+\)/g, '');
    
    // 构建标签匹配部分
    const tagMatch = part.match(/^([a-z][a-z0-9:-]*)/i);
    if (tagMatch) {
      const tagName = tagMatch[1];
      // 构建完整的标签正则表达式部分
      const tagRegex = `\\u003c${tagName}[^\\u003e]*\\u003e`;
      regexParts.push(tagRegex);
    }
  }
  
  // 如果没有有效的正则部分，返回null
  if (regexParts.length === 0) return null;
  
  // 构建完整的正则表达式，允许中间有其他内容
  const combinedRegex = new RegExp(regexParts.join('.*?'), 'is');
  
  const match = combinedRegex.exec(content);
  if (match) {
    return {
      score: 0.8,
      start: match.index,
      end: match.index + match[0].length,
      variantIndex: 0
    };
  }
  
  return null;
}

/**
 * 混合匹配策略函数
 * 按照优先级顺序尝试不同的匹配方法
 * @param domPath 元素的DOM路径
 * @param fileContent 文件内容
 * @param fileType 文件类型
 * @param originalText 原始文本内容
 * @returns 最佳匹配结果或null
 */
export function findBestMatch(domPath: string, fileContent: string, fileType: string, originalText: string): MatchResult | null {
  let bestMatch: MatchResult | null = null;
  
  // 1. 尝试基于ID的快速匹配（最高优先级）
  const idMatch = matchById(domPath, fileContent, fileType);
  if (idMatch && idMatch.score > (bestMatch?.score || 0)) {
    bestMatch = idMatch;
    // 如果ID匹配分数很高，可以直接返回
    if (idMatch.score >= 0.9) {
      return bestMatch;
    }
  }
  
  // 2. 尝试基于DOM结构的匹配（中等优先级）
  const structureMatch = matchByDomStructure(domPath, fileContent, fileType);
  if (structureMatch && structureMatch.score > (bestMatch?.score || 0)) {
    bestMatch = structureMatch;
  }
  
  // 3. 最后尝试基于内容变体的匹配（兜底策略）
  const contentVariants = generateContentVariants(originalText);
  
  // Vue文件特殊处理
  let contentToSearch = fileContent;
  if ((fileType === 'vue' || fileType === '.vue')) {
    const templateMatch = fileContent.match(/\u003ctemplate[\s\S]*?\u003e([\s\S]*?)\u003c\/template\u003e/);
    if (templateMatch) {
      contentToSearch = templateMatch[1];
    }
  }
  
  // 尝试所有内容变体
  for (let i = 0; i < contentVariants.length; i++) {
    const variant = contentVariants[i];
    if (!variant.trim()) continue; // 跳过空变体
    
    const index = contentToSearch.indexOf(variant);
    if (index !== -1) {
      // 内容匹配的分数基础为0.7，但可以根据匹配质量调整
      let contentScore = 0.7;
      
      // 如果是原始内容匹配，分数更高
      if (i === 0) contentScore += 0.1;
      
      // 如果文本较长且完全匹配，分数更高
      if (variant.length > 20) contentScore += 0.1;
      
      // 如果这是更好的匹配，更新最佳匹配
      if (contentScore > (bestMatch?.score || 0)) {
        bestMatch = {
          score: contentScore,
          start: index,
          end: index + variant.length,
          variantIndex: i
        };
      }
    }
  }
  
  return bestMatch;
}

/**
  // 注：内容变体匹配逻辑已移至服务器端实现
  return [...new Set(variants)]
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
      await openEditor(element, sourceFiles, originalContent, debug, 0, originalContent)
    } else if (matches.length > 1) {
      // 多个匹配结果，调用抽屉插件显示多个匹配结果供用户选择
      showSearchResultSelector(matches, async (selectedIndex) => {
        await openEditor(element, sourceFiles, originalContent, debug, selectedIndex, originalContent)
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
 */
async function saveContent(
  element: HTMLElement,
  sourceFiles: string[],
  toolbar: HTMLElement,
  originalStyle: string,
  debug: boolean = false
) {
  try {
    // 获取新内容
    const newContent = element.innerHTML;
    
    // 确定用于替换的旧内容（使用匹配的原始内容或元素的原始内容）
    const oldContentForReplacement = element.getAttribute('data-matched-variant') || element.getAttribute('data-original-content') || element.innerHTML;
    
    // 检查内容是否有变化
    if (newContent === oldContentForReplacement) {
      // 内容未变化，直接取消编辑
      cleanupEdit(element, toolbar, element.getAttribute('data-original-content') || newContent, originalStyle);

      return;
    }

    // 调用update-content接口保存内容
    const response = await fetch('/api/easy-editor/update-content', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: sourceFiles, // 保持与update-content.ts接口兼容性
        content: {
          old: oldContentForReplacement,
          new: newContent
        }
      })
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
  if (window.__NUXT__) {
    // 调用Nuxt的组件挂载机制来显示抽屉插件

    
    // 通过全局变量传递匹配结果和回调函数
    window.__EASY_EDITOR_MATCHES__ = matches;
    window.__EASY_EDITOR_SELECT_CALLBACK__ = onSelect;
    
    // 触发抽屉显示事件
    const event = new CustomEvent('easy-editor:show-drawer', {
      detail: {
        component: '/runtime/components/searchResult.vue',
        props: {
          matches,
          onSelect
        }
      }
    });
    window.dispatchEvent(event);
  } else {
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