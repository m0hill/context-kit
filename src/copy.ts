import { Buffer } from 'buffer'
import * as vscode from 'vscode'

import { ContextKitState } from './state'
import { escapeXml, inferLanguage, isBinary } from './utils'

interface CopyOptions {
  prompt?: string
  includePrompt?: boolean
  includeSavedPrompts?: boolean
  includeFiles?: boolean
}

export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024

export async function copySelection(
  state: ContextKitState,
  webview?: vscode.Webview,
  options?: CopyOptions
) {
  const entries = state.getSelectionEntries()
  const rawPrompt = options?.prompt ?? state.getPrompt()
  const includePrompt = options?.includePrompt ?? state.getIncludePrompt()
  const includeSavedPrompts = options?.includeSavedPrompts ?? state.getIncludeSavedPrompts()
  const includeFiles = options?.includeFiles ?? state.getIncludeFiles()
  const trimmedInstructions = includePrompt ? rawPrompt.trim() : ''
  const metaPrompts = includeSavedPrompts ? state.getSelectedMetaPrompts() : []
  const hasMetaPrompts = metaPrompts.length > 0
  const postStatus = (text: string, level: 'info' | 'warning' = 'info') => {
    webview?.postMessage({ type: 'status', text, level })
  }
  const fileTreeContent = entries.length ? buildFileTreeText(entries.map(entry => entry.path)) : ''
  const fileTreeBlock = fileTreeContent
    ? `<fileTree>
${escapeXml(fileTreeContent)}
</fileTree>`
    : ''
  const blocks: string[] = []
  const skipped: string[] = []
  if (includeFiles) {
    for (const entry of entries) {
      try {
        let size = typeof entry.size === 'number' ? entry.size : undefined
        if (size === undefined) {
          try {
            const stat = await vscode.workspace.fs.stat(entry.uri)
            size = stat.size
            entry.size = stat.size
          } catch {
            size = undefined
          }
        }
        if (typeof size === 'number' && size > MAX_FILE_SIZE_BYTES) {
          skipped.push(`${entry.path} (too large)`)
          continue
        }
        const buffer = await vscode.workspace.fs.readFile(entry.uri)
        if (isBinary(buffer)) {
          skipped.push(`${entry.path} (binary)`)
          continue
        }
        const content = Buffer.from(buffer).toString('utf8').replace(/```/g, '\u0060\u0060\u0060')
        const language = inferLanguage(entry.path)
        const opener = language ? '```' + language : '```'
        blocks.push([`<file path="${entry.path}">`, opener, content, '```', '</file>'].join('\n'))
      } catch (error) {
        skipped.push(`${entry.path} (unreadable)`)
      }
    }
  }
  const fileSection = includeFiles && blocks.length ? blocks.join('\n\n') : ''
  const hasAnyContent = Boolean(
    fileTreeBlock || fileSection || trimmedInstructions || hasMetaPrompts
  )
  if (!hasAnyContent) {
    const rawTrimmed = rawPrompt.trim()
    if (rawTrimmed && !includePrompt) {
      const text = 'Enable "Include user instructions" to copy without selected files.'
      postStatus(text, 'warning')
      return
    }
    if (!entries.length) {
      postStatus('No files selected', 'warning')
    } else {
      postStatus('No eligible files to copy.', 'warning')
    }
    return
  }
  const instructionsBlock = trimmedInstructions
    ? `<userInstructions>
${escapeXml(trimmedInstructions)}
</userInstructions>`
    : ''
  const metaBlock = hasMetaPrompts
    ? `<metaInstructions>
${metaPrompts
  .map(prompt => {
    const name = escapeXml(prompt.name)
    const body = escapeXml(prompt.body.trim())
    if (!body) {
      return `<metaInstruction name="${name}" />`
    }
    return `<metaInstruction name="${name}">
${body}
</metaInstruction>`
  })
  .join('\n')}
</metaInstructions>`
    : ''
  const sections = ['<context>']
  if (fileTreeBlock) {
    sections.push(fileTreeBlock)
  }
  if (fileSection) {
    sections.push(fileSection)
  }
  if (metaBlock) {
    sections.push(metaBlock)
  }
  if (instructionsBlock) {
    sections.push(instructionsBlock)
  }
  sections.push('</context>')
  const payload = sections.filter(Boolean).join('\n\n')
  await vscode.env.clipboard.writeText(payload)
  if (skipped.length) {
    postStatus(`Context copied to clipboard. Skipped: ${skipped.join(', ')}`, 'warning')
  } else {
    postStatus('Context copied to clipboard')
  }
}

interface FileTreeNode {
  name: string
  type: 'folder' | 'file'
  children?: Map<string, FileTreeNode>
}

function buildFileTreeText(paths: readonly string[]) {
  const uniquePaths = Array.from(new Set(paths)).sort()
  const root = new Map<string, FileTreeNode>()
  for (const path of uniquePaths) {
    addPath(root, path.split('/'), 0)
  }
  const lines: string[] = []
  const nodes = sortNodes([...root.values()])
  if (nodes.length) {
    lines.push('.')
    nodes.forEach((node, index) => {
      traverseTree(node, '', index === nodes.length - 1, lines)
    })
  }
  return lines.join('\n')
}

function addPath(container: Map<string, FileTreeNode>, segments: readonly string[], index: number) {
  if (index >= segments.length) {
    return
  }
  const name = segments[index]
  const isLeaf = index === segments.length - 1
  let node = container.get(name)
  if (!node) {
    node = {
      name,
      type: isLeaf ? 'file' : 'folder',
      children: isLeaf ? undefined : new Map<string, FileTreeNode>(),
    }
    container.set(name, node)
  }
  if (isLeaf) {
    node.type = 'file'
    return
  }
  if (!node.children) {
    node.children = new Map<string, FileTreeNode>()
  }
  node.type = 'folder'
  const childContainer = node.children
  if (childContainer) {
    addPath(childContainer, segments, index + 1)
  }
}

function traverseTree(node: FileTreeNode, prefix: string, isLast: boolean, lines: string[]) {
  const connector = isLast ? '└── ' : '├── '
  const suffix = node.type === 'folder' ? '/' : ''
  lines.push(`${prefix}${connector}${node.name}${suffix}`)
  if (node.type === 'folder' && node.children && node.children.size) {
    const children = sortNodes([...node.children.values()])
    const nextPrefix = prefix + (isLast ? '    ' : '│   ')
    children.forEach((child, index) => {
      traverseTree(child, nextPrefix, index === children.length - 1, lines)
    })
  }
}

function sortNodes(nodes: FileTreeNode[]) {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}
