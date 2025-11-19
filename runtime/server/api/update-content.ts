import { defineEventHandler, readBody } from 'h3'
import { writeFileSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { escapeRegExp } from './utils'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { files, content: { old: oldContent, new: newContent, selector } } = body

    // Validate parameters
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, error: 'No files provided' }
    }
    if (typeof oldContent !== 'string' || typeof newContent !== 'string') {
      return { success: false, error: 'Invalid content format' }
    }

    // Process each file
    const updatedFiles = []
    for (const filePath of files) {
      try {
        const resolvedPath = resolve(filePath)
        const fileContent = readFileSync(resolvedPath, 'utf8')

        // Replace content
        let updatedContent
        if (selector) {
          // Using CSS selector to find and replace content
          // This is a simplified implementation - in real scenarios, you might need a more robust parser
          const regex = new RegExp(`(<${selector}[^>]*>)([\s\S]*?)(<\/${selector}>)`, 'gi')
          updatedContent = fileContent.replace(regex, `$1${newContent}$3`)
        } else {
          // Simple string replacement
          updatedContent = fileContent.replace(new RegExp(escapeRegExp(oldContent), 'g'), newContent)
        }

        writeFileSync(resolvedPath, updatedContent, 'utf8')
        updatedFiles.push(filePath)
      } catch (error) {
        console.error(`Error updating file ${filePath}:`, error)
        // Continue processing other files
      }
    }

    return { success: true, updatedFiles }
  } catch (error) {
    console.error('Error in update-content API:', error)
    return { success: false, error: error.message || 'Failed to update content' }
  }
})