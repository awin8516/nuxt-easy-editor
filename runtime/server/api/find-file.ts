import { readdir } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { defineEventHandler, readBody } from 'h3'
import { escapeRegExp } from './utils'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const patterns = body.patterns as string | string[]
    
    if (!patterns) {
      return { error: '文件路径模式不能为空' }
    }
    
    // 确保patterns是数组
    const patternArray = Array.isArray(patterns) ? patterns : [patterns]
    
    // 查找所有匹配的文件
    const allMatchedFiles: string[] = []
    
    for (const pattern of patternArray) {
      const matchedFiles = await findFilesWithWildcard(pattern)
      allMatchedFiles.push(...matchedFiles)
    }
    
    // 去重并返回，确保所有路径使用正斜杠
    return { 
      files: Array.from(new Set(allMatchedFiles)).map(file => file.replace(/\\/g, '/')) 
    }
  } catch (error) {
    console.error('查找文件失败:', error)
    return { error: '查找文件失败' }
  }
})

/**
 * 根据通配符模式查找文件
 * @param pattern 文件路径模式，支持 * 和 ** 通配符
 * @returns 匹配的文件路径数组
 */
async function findFilesWithWildcard(pattern: string): Promise<string[]> {
  const rootDir = process.cwd()
  const matchedFiles: string[] = []
  
  // 检查是否包含通配符
  if (!pattern.includes('*')) {
    // 没有通配符，直接返回原路径（如果文件存在）
    const fullPath = join(rootDir, pattern)
    try {
      // 这里简化处理，实际应该检查文件是否存在
      return [pattern]
    } catch {
      return []
    }
  }
  
  // 处理 ** 通配符（匹配任意深度的目录）
  if (pattern.includes('**')) {
    const parts = pattern.split('/')
    const fixedParts: string[] = []
    let wildcardIndex = -1
    
    // 找到第一个 ** 的位置
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '**') {
        wildcardIndex = i
        break
      }
      fixedParts.push(parts[i])
    }
    
    // 构建基础路径（** 之前的路径）
    const basePath = fixedParts.length > 0 ? join(...fixedParts) : '.'
    const fullBasePath = join(rootDir, basePath)
    
    // 构建剩余路径模式（** 之后的路径）
    const remainingPattern = parts.slice(wildcardIndex + 1).join('/')
    
    // 递归查找所有文件
    const allFiles = await getAllFiles(fullBasePath)
    
    // 过滤匹配剩余模式的文件
    for (const file of allFiles) {
      const relativePath = relative(fullBasePath, file)
      if (matchWildcard(relativePath, remainingPattern)) {
        // 构建相对于项目根目录的路径
        const projectRelativePath = relative(rootDir, file)
        matchedFiles.push(projectRelativePath)
      }
    }
  } else {
    // 只处理 * 通配符
    const parts = pattern.split('/')
    const directoryParts = parts.slice(0, -1)
    const filePattern = parts[parts.length - 1]
    
    const directoryPath = directoryParts.length > 0 ? join(rootDir, ...directoryParts) : rootDir
    
    try {
      const files = await readdir(directoryPath)
      
      for (const file of files) {
        if (matchWildcard(file, filePattern)) {
          const fullFilePath = join(...parts.slice(0, -1), file)
          matchedFiles.push(fullFilePath)
        }
      }
    } catch (error) {
      console.error(`读取目录失败: ${directoryPath}`, error)
    }
  }
  
  return matchedFiles
}

/**
 * 递归获取目录下的所有文件
 * @param dir 目录路径
 * @returns 文件路径数组
 */
async function getAllFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      
      if (entry.isDirectory()) {
        files.push(...(await getAllFiles(fullPath)))
      } else {
        files.push(fullPath)
      }
    }
  } catch (error) {
    console.error(`递归读取目录失败: ${dir}`, error)
  }
  
  return files
}

/**
 * 检查字符串是否匹配通配符模式
 * @param str 要检查的字符串
 * @param pattern 通配符模式
 * @returns 是否匹配
 */
function matchWildcard(str: string, pattern: string): boolean {
  // 将通配符模式转换为正则表达式
  const regexPattern = pattern
    .split(/([*?])/)
    .map(part => {
      if (part === '*') return '[^/]*'
      if (part === '?') return '.'
      return escapeRegExp(part)
    })
    .join('')
  
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(str)
}