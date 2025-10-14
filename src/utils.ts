import * as path from 'path'
import * as vscode from 'vscode'

export function inferLanguage(filePath: string) {
  const ext = path.extname(filePath).toLowerCase().slice(1)
  if (!ext) {
    return ''
  }
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    cjs: 'javascript',
    mjs: 'javascript',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    html: 'html',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    py: 'python',
    java: 'java',
    cs: 'csharp',
    cpp: 'cpp',
    h: 'c',
    c: 'c',
    go: 'go',
    rb: 'ruby',
    php: 'php',
    rust: 'rust',
    sql: 'sql',
    sh: 'bash',
  }
  return map[ext] ?? ext
}

export function getWorkspaceLabel(folderUri: vscode.Uri) {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.length <= 1) {
    return folders[0]?.name ?? path.basename(folderUri.fsPath)
  }
  return folderUri.path.split('/').pop() || folderUri.fsPath
}

export function isBinary(buffer: Uint8Array) {
  const limit = Math.min(buffer.length, 512)
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) {
      return true
    }
  }
  return false
}

export function formatBytes(bytes: number) {
  if (!bytes) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function toPosix(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/')
}

export function splitPathSegments(value: string) {
  return value.split(/[/\\]+/).filter(Boolean)
}

export function getNonce() {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 16; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
