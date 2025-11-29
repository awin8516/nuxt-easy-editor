import { defineEventHandler, readBody } from 'h3'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve, isAbsolute } from 'path'

export default defineEventHandler(async (event) => {
  try {
    // 读取请求体
    const body = await readBody(event)
    const { files, content: { old: oldContent, new: newContent } = {}, line } = body
    
    // 参数验证
    if (!Array.isArray(files) || files.length === 0) {
      console.log('[update-content] 错误: 未提供文件')
      return { success: false, error: 'No files provided' }
    }
    if (typeof oldContent !== 'string' || typeof newContent !== 'string') {
      console.log('[update-content] 错误: 内容格式无效')
      return { success: false, error: 'Invalid content format' }
    }

    // 处理每个文件
    const updatedFiles = []
    for (const filePath of files) {
      try {
        // 解析文件路径
        const resolvedPath = isAbsolute(filePath) 
          ? filePath 
          : resolve(process.cwd(), filePath)
        
        console.log(`[update-content] 处理文件: ${filePath}`)
        
        // 检查文件是否存在
        if (!existsSync(resolvedPath)) {
          console.error(`[update-content] 错误: 文件不存在 ${resolvedPath}`)
          continue
        }
        
        // 读取文件内容
        const fileContent = readFileSync(resolvedPath, 'utf8')
        
        // 增强的内容替换逻辑，避免错误替换HTML标签
        let updatedContent = fileContent
        
        // 如果提供了行号，进行按行精确替换
        if (typeof line === 'number' && line > 0) {
          console.log(`[update-content] 按行号替换，文件: ${filePath}, 行号: ${line}`)
          updatedContent = replaceLineContent(fileContent, line, oldContent, newContent)
        } else {
          // 没有提供行号，使用原有的替换逻辑
          // 检查是否存在HTML标签
          if (containsHtmlTags(oldContent) && containsHtmlTags(newContent)) {
            // 当旧内容和新内容都包含HTML标签时，尝试更精确地匹配
            // 提取标签结构和文本内容进行匹配
            const oldTagContent = extractTagContent(oldContent)
            const newTagContent = extractTagContent(newContent)
            
            if (oldTagContent && newTagContent) {
              // 尝试匹配标签结构并替换内容
              updatedContent = replaceTagContent(fileContent, oldTagContent, newTagContent)
            } else {
              // 如果无法提取标签内容，使用宽松的匹配方式
              updatedContent = fileContent.replace(new RegExp(escapeRegex(oldContent), 'g'), newContent)
            }
          } else {
            // 普通文本内容，使用更安全的替换方式
            updatedContent = fileContent.replace(new RegExp(escapeRegex(oldContent), 'g'), newContent)
          }
        }
        
        // 如果内容有变化则写入文件
        if (updatedContent !== fileContent) {
          writeFileSync(resolvedPath, updatedContent, 'utf8')
          updatedFiles.push(filePath)
          console.log(`[update-content] 文件更新成功: ${filePath}`)
        } else {
          console.log(`[update-content] 文件内容未变化: ${filePath}`)
        }
      } catch (error) {
        console.error(`更新文件 ${filePath} 时出错:`, error)
        // 继续处理其他文件
      }
    }

    return { success: true, updatedFiles }
  } catch (error) {
    console.error('update-content API 错误:', error)
    return { success: false, error: error.message || 'Failed to update content' }
  }
})

/**
 * 检查字符串是否包含HTML标签
 */
function containsHtmlTags(str: string): boolean {
  return /<[^>]*>/i.test(str)
}

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 提取HTML标签内容结构
 */
interface TagContent {
  fullTag: string
  tagName: string
  attributes: string
  innerHtml: string
}

function extractTagContent(html: string): TagContent | null {
  // 尝试匹配常见的HTML标签格式
  const match = html.match(/<(\w+)([^>]*)>([\s\S]*?)<\/\1>/i)
  if (!match) return null
  
  return {
    fullTag: match[0],
    tagName: match[1].toLowerCase(),
    attributes: match[2],
    innerHtml: match[3]
  }
}

/**
 * 替换HTML标签内容而保持标签结构
 */
function replaceTagContent(fileContent: string, oldTag: TagContent, newTag: TagContent): string {
  // 创建正则表达式匹配旧标签内容
  const tagRegex = new RegExp(
    `<${oldTag.tagName}${escapeRegex(oldTag.attributes)}>[\n\s]*${escapeRegex(oldTag.innerHtml)}[\n\s]*<\\/${oldTag.tagName}>`, 
    'gi'
  )
  
  // 保持原有标签名和属性，只替换内部内容
  const replacement = `<${oldTag.tagName}${oldTag.attributes}>${newTag.innerHtml}</${oldTag.tagName}>`
  
  return fileContent.replace(tagRegex, replacement)
}

/**
 * 按行号精确替换内容，保留原始文件格式
 */
function replaceLineContent(fileContent: string, targetLine: number, oldContent: string, newContent: string): string {
  // 按行分割文件内容
  const lines = fileContent.split('\n')
  
  // 行号从1开始，需要减去1转换为数组索引
  const lineIndex = targetLine - 1
  
  // 检查行号是否有效
  if (lineIndex < 0 || lineIndex >= lines.length) {
    console.error(`[update-content] 无效的行号: ${targetLine}，文件总行数: ${lines.length}`)
    return fileContent
  }
  
  // 获取目标行内容
  const targetLineContent = lines[lineIndex]
  
  // 添加调试日志
  console.log(`[update-content] 目标行内容: "${targetLineContent.trim()}"`)
  console.log(`[update-content] 要查找的内容: "${oldContent.trim()}"`)
  
  // 方法1：直接精确匹配 - 优先使用，确保严格保留格式
  if (targetLineContent.includes(oldContent)) {
    // 只替换该行中匹配的内容，严格保留原始格式
    lines[lineIndex] = targetLineContent.replace(oldContent, newContent)
    console.log(`[update-content] 成功替换行 ${targetLine} 内容 - 直接精确匹配`)
  } else {
    // 方法2：智能内容匹配 - 处理空白字符差异但保留原始格式
    const targetTrimmed = targetLineContent.trim();
    const oldTrimmed = oldContent.trim();
    
    // 检查去除前后空白后是否匹配
    if (targetTrimmed === oldTrimmed) {
      // 完全匹配，保留原始缩进
      const indentation = targetLineContent.match(/^\s*/)[0]; // 提取原始缩进
      lines[lineIndex] = indentation + newContent.trim(); // 应用相同缩进
      console.log(`[update-content] 成功替换行 ${targetLine} 内容 - 保留原始缩进`)
    } else {
      // 方法3：内容部分匹配
      if (targetTrimmed.includes(oldTrimmed)) {
        // 使用正则表达式查找精确的内容位置，同时保留空白字符
        const startIndex = targetLineContent.indexOf(oldTrimmed);
        if (startIndex !== -1) {
          // 精确替换找到的内容，不影响其他部分
          const before = targetLineContent.substring(0, startIndex);
          const after = targetLineContent.substring(startIndex + oldTrimmed.length);
          lines[lineIndex] = before + newContent + after;
          console.log(`[update-content] 成功替换行 ${targetLine} 内容 - 部分内容匹配`)
        } else {
          // 方法4：宽松内容匹配
          // 寻找最佳匹配位置，确保最小化对原始格式的影响
          const targetClean = targetLineContent.replace(/\s+/g, ' ');
          const oldClean = oldContent.replace(/\s+/g, ' ');
          
          if (targetClean.includes(oldClean)) {
            // 尝试在原始内容中找到最接近的匹配
            // 这种方法可能不是完美的，但尽量减少对格式的影响
            lines[lineIndex] = targetLineContent.replace(oldContent.trim(), newContent);
            console.log(`[update-content] 尝试替换行 ${targetLine} 内容 - 宽松内容匹配`)
          } else {
            console.log(`[update-content] 无法在目标行 ${targetLine} 中找到匹配内容，保持原始内容不变`)
          }
        }
      } else {
        console.log(`[update-content] 目标行内容与要查找的内容不匹配，保持原始内容不变`)
      }
    }
  }
  
  // 将修改后的行重新组合为文件内容，严格保留原始行分隔符
  return lines.join('\n')
}