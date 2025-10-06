import * as vscode from 'vscode'

import { FileEntry, MetaPrompt, WebviewNode } from './types'

export class ContextKitState {
  private files = new Map<string, FileEntry>()
  private selected = new Set<string>()
  private expanded = new Set<string>()
  private metaPrompts: MetaPrompt[] = []
  private selectedMetaPromptIds = new Set<string>()
  private viewMode: 'main' | 'manage' = 'main'
  respectGitignore = true
  prompt = ''
  includePrompt = true
  includeSavedPrompts = true
  includeFiles = true

  setFiles(files: Map<string, FileEntry>) {
    this.files = files
    this.selected = new Set([...this.selected].filter(path => this.files.has(path)))
  }

  addFiles(entries: readonly FileEntry[]) {
    for (const e of entries) {
      this.files.set(e.path, e)
    }
    this.selected = new Set([...this.selected].filter(p => this.files.has(p)))
  }

  setRespectGitignore(value: boolean) {
    this.respectGitignore = value
  }

  setExpanded(paths: string[]) {
    this.expanded = new Set(paths)
  }

  clearExpanded() {
    this.expanded.clear()
  }

  getExpandedPaths() {
    return [...this.expanded]
  }

  pruneExpandedWithNodes(nodes: WebviewNode[]) {
    const available = new Set<string>()
    const visit = (items: WebviewNode[]) => {
      for (const item of items) {
        if (item.type === 'folder') {
          available.add(item.path)
          if (item.children?.length) {
            visit(item.children)
          }
        }
      }
    }
    visit(nodes)
    if (!available.size && !this.expanded.size) {
      return
    }
    this.expanded = new Set([...this.expanded].filter(path => available.has(path)))
  }

  setPrompt(value: string) {
    this.prompt = value
  }

  setIncludePrompt(value: boolean) {
    this.includePrompt = value
  }

  setIncludeSavedPrompts(value: boolean) {
    this.includeSavedPrompts = value
  }

  setIncludeFiles(value: boolean) {
    this.includeFiles = value
  }

  setMetaPrompts(prompts: MetaPrompt[]) {
    this.metaPrompts = prompts
    this.selectedMetaPromptIds = new Set(
      [...this.selectedMetaPromptIds].filter(id =>
        this.metaPrompts.some(prompt => prompt.id === id)
      )
    )
  }

  setSelectedMetaPromptIds(ids: string[]) {
    const valid = new Set(this.metaPrompts.map(prompt => prompt.id))
    this.selectedMetaPromptIds = new Set(ids.filter(id => valid.has(id)))
  }

  getSelectedMetaPromptIds() {
    return [...this.selectedMetaPromptIds]
  }

  getSelectedMetaPrompts() {
    const set = new Set(this.selectedMetaPromptIds)
    return this.metaPrompts.filter(prompt => set.has(prompt.id))
  }

  getMetaPrompts() {
    return this.metaPrompts
  }

  setViewMode(mode: 'main' | 'manage') {
    this.viewMode = mode
  }

  getViewMode() {
    return this.viewMode
  }

  setSelection(paths: string[]) {
    this.selected = new Set(paths.filter(path => this.files.has(path)))
  }

  clearSelection() {
    this.selected.clear()
  }

  getSelectionEntries(): FileEntry[] {
    return [...this.selected]
      .map(path => this.files.get(path))
      .filter((entry): entry is FileEntry => Boolean(entry))
  }

  getPrompt() {
    return this.prompt
  }

  getIncludePrompt() {
    return this.includePrompt
  }

  getIncludeSavedPrompts() {
    return this.includeSavedPrompts
  }

  getIncludeFiles() {
    return this.includeFiles
  }

  getFileEntry(path: string) {
    return this.files.get(path)
  }

  async getSelectionSummary() {
    const entries = this.getSelectionEntries()
    let totalBytes = 0
    const limit = Math.min(16, Math.max(1, entries.length))
    let index = 0
    const run = async () => {
      while (true) {
        const i = index
        if (i >= entries.length) {
          break
        }
        index += 1
        const entry = entries[i]
        try {
          const size =
            typeof entry.size === 'number'
              ? entry.size
              : (await vscode.workspace.fs.stat(entry.uri)).size
          if (typeof size === 'number') {
            entry.size = size
            totalBytes += size
          }
        } catch {}
      }
    }
    await Promise.all(Array.from({ length: limit }, run))
    const tokenCount = totalBytes ? Math.ceil(totalBytes / 4) : 0
    return {
      count: entries.length,
      tokenCount,
    }
  }
}
