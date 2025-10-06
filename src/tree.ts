import { Buffer } from 'buffer'
import ignore from 'ignore'
import * as vscode from 'vscode'

import { FileEntry, TreeData, WebviewNode } from './types'
import { getWorkspaceLabel, toPosix } from './utils'

const ENTRY_CONCURRENCY = 16

interface BuildDirectoryParams {
  directory: vscode.Uri
  label: string
  displayPath: string
  relative: string
  respectGitignore: boolean
  patterns: readonly string[]
  files: Map<string, FileEntry>
  gitignoreCache: Map<string, readonly string[]>
}

export async function loadWorkspaceTree(respectGitignore: boolean): Promise<TreeData> {
  const folders = vscode.workspace.workspaceFolders ?? []
  const files = new Map<string, FileEntry>()
  const gitignoreCache = new Map<string, readonly string[]>()
  const nodes: WebviewNode[] = []
  for (const folder of folders) {
    const label = getWorkspaceLabel(folder.uri)
    const node = await buildDirectory({
      directory: folder.uri,
      label,
      displayPath: label,
      relative: '',
      respectGitignore,
      patterns: [],
      files,
      gitignoreCache,
    })
    if (node) {
      nodes.push(node)
    }
  }
  return { nodes, files }
}

async function buildDirectory(params: BuildDirectoryParams): Promise<WebviewNode | undefined> {
  const { directory, label, displayPath, relative, respectGitignore, files, gitignoreCache } =
    params

  let entries: [string, vscode.FileType][]
  try {
    entries = await vscode.workspace.fs.readDirectory(directory)
  } catch (error) {
    return undefined
  }

  let patterns = respectGitignore ? params.patterns : []
  if (respectGitignore) {
    const hasGitignore = entries.some(
      ([name, type]) => name === '.gitignore' && (type & vscode.FileType.File) !== 0
    )
    if (hasGitignore) {
      const scoped = await loadGitignorePatterns(directory, relative, gitignoreCache)
      if (scoped.length) {
        patterns = [...patterns, ...scoped]
      }
    }
  }
  const matcher = respectGitignore && patterns.length ? ignore().add(patterns) : undefined

  const filtered = entries
    .filter(([name]) => name !== '.git')
    .sort((a, b) => {
      const aIsDir = (a[1] & vscode.FileType.Directory) !== 0
      const bIsDir = (b[1] & vscode.FileType.Directory) !== 0
      if (aIsDir !== bIsDir) {
        return aIsDir ? -1 : 1
      }
      return a[0].localeCompare(b[0])
    })

  const childNodes = await mapWithConcurrency(filtered, ENTRY_CONCURRENCY, async ([name, type]) => {
    const childUri = vscode.Uri.joinPath(directory, name)
    let entryType = type
    if ((entryType & vscode.FileType.SymbolicLink) !== 0) {
      try {
        entryType = (await vscode.workspace.fs.stat(childUri)).type
      } catch (error) {
        return undefined
      }
    }
    const childRelative = relative ? `${relative}/${name}` : name
    const normalized = toPosix(childRelative)
    const isIgnored = matcher
      ? matcher.ignores(normalized) || matcher.ignores(`${normalized}/`)
      : false
    if (respectGitignore && isIgnored) {
      return undefined
    }
    if ((entryType & vscode.FileType.Directory) !== 0) {
      const node = await buildDirectory({
        directory: childUri,
        label: name,
        displayPath: `${displayPath}/${name}`,
        relative: childRelative,
        respectGitignore,
        patterns,
        files,
        gitignoreCache,
      })
      if (node) {
        node.ignored = Boolean(isIgnored)
      }
      return node
    }
    if ((entryType & vscode.FileType.File) !== 0) {
      const node = createFileNode(childUri, `${displayPath}/${name}`, name, files)
      if (node) {
        node.ignored = Boolean(isIgnored)
      }
      return node
    }
    return undefined
  })

  return {
    label,
    path: displayPath,
    type: 'folder',
    ignored: false,
    children: childNodes.filter((node): node is WebviewNode => Boolean(node)),
  }
}

function createFileNode(
  fileUri: vscode.Uri,
  displayPath: string,
  name: string,
  files: Map<string, FileEntry>
) {
  const node: WebviewNode = {
    label: name,
    path: displayPath,
    type: 'file',
  }
  files.set(displayPath, {
    path: displayPath,
    uri: fileUri,
  })
  return node
}

async function loadGitignorePatterns(
  directory: vscode.Uri,
  relativeDir: string,
  cache: Map<string, readonly string[]>
) {
  const key = directory.toString()
  if (cache.has(key)) {
    return cache.get(key) ?? []
  }
  const gitignoreUri = vscode.Uri.joinPath(directory, '.gitignore')
  try {
    const buffer = await vscode.workspace.fs.readFile(gitignoreUri)
    const lines = Buffer.from(buffer).toString('utf8').split(/\r?\n/)
    const scoped: string[] = []
    const prefix = relativeDir ? `${relativeDir}/` : ''
    for (const entry of lines) {
      const trimmed = entry.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }
      const isNegated = trimmed.startsWith('!')
      const body = isNegated ? trimmed.slice(1) : trimmed
      const cleaned = body.replace(/^\//, '')
      const scopedPattern = `${isNegated ? '!' : ''}${toPosix(`${prefix}${cleaned}`)}`
      scoped.push(scopedPattern)
    }
    cache.set(key, scoped)
    return scoped
  } catch (error) {
    cache.set(key, [])
    return []
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R | undefined>
) {
  const results: (R | undefined)[] = new Array(items.length)
  let index = 0
  const run = async () => {
    while (true) {
      const current = index
      if (current >= items.length) {
        break
      }
      index += 1
      results[current] = await mapper(items[current], current)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, run)
  await Promise.all(workers)
  return results.filter((value): value is R => value !== undefined)
}
