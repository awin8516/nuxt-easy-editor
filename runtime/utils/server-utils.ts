import fastGlob from 'fast-glob'
import { resolve } from 'path'

/**
 * 增强的trim函数，去除字符串前后所有类型的空白字符，包括U+00a0非断行空格
 * @param str 要处理的字符串
 * @returns 处理后的字符串
 */
export function enhancedTrim(str: string): string {
  // 使用正则表达式匹配并移除所有类型的空白字符
  return str.replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '')
}

/**
 * 标准化空白字符函数，将所有空白字符（包括普通空格、非断行空格等）替换为单个标准空格
 * 并去除字符串前后的空白字符
 * @param str 要处理的字符串
 * @returns 标准化后的字符串
 */
export function normalizeWhitespace(str: string): string {
  // 首先使用增强的trim函数去除前后空白
  const trimmed = enhancedTrim(str)
  // 然后将所有连续的空白字符（包括U+00a0非断行空格）替换为单个标准空格
  return trimmed.replace(/[\s\u00a0]+/g, ' ')
}

/**
 * 解析文件路径（支持绝对路径和相对路径）
 * @param filePath 文件路径
 * @returns 解析后的绝对路径
 */
export function resolveFilePath(filePath: string): string {
  // 首先使用增强的trim函数处理文件路径，去除包括U+00a0在内的所有空白字符
  const trimmedPath = enhancedTrim(filePath)
  
  const resolvedPath = trimmedPath.startsWith('/') || trimmedPath.match(/^[a-zA-Z]:/)
    ? trimmedPath
    : resolve(process.cwd(), trimmedPath)
  
  // 防止路径遍历攻击
  const normalizedPath = resolve(resolvedPath)
  const cwd = resolve(process.cwd())
  
  // 确保路径在当前工作目录下
  if (!normalizedPath.startsWith(cwd)) {
    throw new Error('Path traversal attack detected')
  }
  
  return normalizedPath
}

/**
 * 展开通配符路径
 * @param pattern 通配符模式
 * @returns 匹配的文件路径数组
 */
export async function expandGlobPattern(pattern: string): Promise<string[]> {
  // 使用增强的trim函数处理通配符模式
  const trimmedPattern = enhancedTrim(pattern)
  
  if (!trimmedPattern.includes('*') && !trimmedPattern.includes('?')) {
    return [trimmedPattern]
  }

  try {
    const matchedFiles = await fastGlob(trimmedPattern, {
      cwd: process.cwd(),
      absolute: true,
      onlyFiles: true,
      ignore: ['node_modules/**']
    })
    return matchedFiles.length > 0 ? matchedFiles : []
  } catch (error) {
    console.warn(`[Visual Editor] Glob pattern failed: ${pattern}`, error)
    return []
  }
}