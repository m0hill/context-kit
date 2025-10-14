import { Buffer } from 'buffer'
import ignore from 'ignore'
import * as vscode from 'vscode'

import { copySelection } from './copy'
import { IconThemeManager, IconThemeNodeIcon } from './iconTheme'
import { addMetaPrompt, deleteMetaPrompt, loadMetaPrompts, updateMetaPrompt } from './metaPrompts'
import { ContextKitState } from './state'
import { collectWorkspaceFiles } from './tree'
import {
  ExtensionToWebviewMessage,
  FileEntry,
  TreeData,
  VIEW_ID,
  WebviewNode,
  WebviewNodeIcon,
  WebviewNodeIconVariant,
  WebviewToExtensionMessage,
} from './types'
import { getWorkspaceLabel, toPosix } from './utils'
import { getWebviewHtml } from './webview/html'

export class ContextKitViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private ready = false
  private refreshToken = 0
  private readonly iconManager = new IconThemeManager()
  private dirInfo = new Map<
    string,
    { uri: vscode.Uri; root: vscode.Uri; relative: string; patterns: readonly string[] }
  >()
  private gitignoreCache = new Map<string, readonly string[]>()

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: ContextKitState
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('workbench.iconTheme')) {
          void this.iconManager.reload().then(() => {
            if (this.ready) {
              void this.refreshTree()
            }
          })
        }
      })
    )
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    }
    webviewView.webview.html = getWebviewHtml(this.context, webviewView.webview)
    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      const parsed = isWebviewToExtensionMessage(message)
      if (!parsed) {
        return
      }
      await this.handleMessage(parsed)
    })
  }

  getWebview() {
    return this.view?.webview
  }

  async refreshTree() {
    if (!this.view || !this.ready) {
      return
    }
    const currentToken = ++this.refreshToken
    this.view.webview.postMessage({ type: 'loading' } satisfies ExtensionToWebviewMessage)
    const folders = vscode.workspace.workspaceFolders
    if (!folders || !folders.length) {
      this.state.setFiles(new Map())
      this.state.clearSelection()
      this.state.clearExpanded()
      this.postFileIndex(new Map())
      this.view.webview.postMessage({ type: 'noWorkspace' } satisfies ExtensionToWebviewMessage)
      void this.postSelectionSummary()
      this.postUiState()
      return
    }
    try {
      await this.iconManager.ensureLoaded()
      this.updateLocalResourceRoots()
      this.dirInfo.clear()
      this.gitignoreCache.clear()
      this.state.setFiles(new Map())
      const rootNodes: WebviewNode[] = []
      for (const folder of folders) {
        const label = getWorkspaceLabel(folder.uri)
        rootNodes.push({
          label,
          path: label,
          type: 'folder',
          ignored: false,
          hasChildren: true,
        })
        this.dirInfo.set(label, { uri: folder.uri, root: folder.uri, relative: '', patterns: [] })
      }
      const nodes = this.prepareNodesForWebview(rootNodes)
      this.view.webview.postMessage({
        type: 'treeData',
        nodes,
        selection: this.state.getSelectionEntries().map(e => e.path),
        respectGitignore: this.state.respectGitignore,
        prompt: this.state.getPrompt(),
        includePrompt: this.state.getIncludePrompt(),
        includeSavedPrompts: this.state.getIncludeSavedPrompts(),
        includeFiles: this.state.getIncludeFiles(),
        expanded: this.state.getExpandedPaths(),
      } satisfies ExtensionToWebviewMessage)
      void this.refreshFileIndex(currentToken)
      void this.postSelectionSummary()
      this.postUiState()
      if (currentToken !== this.refreshToken) {
        return
      }
    } catch {
      if (currentToken === this.refreshToken) {
        this.view.webview.postMessage({
          type: 'warning',
          text: 'Failed to load workspace files.',
        } satisfies ExtensionToWebviewMessage)
        this.postUiState()
      }
    }
  }

  private postFileIndex(files: Map<string, FileEntry>) {
    if (!this.view) {
      return
    }
    this.view.webview.postMessage({
      type: 'fileIndex',
      files: [...files.values()].map(entry => entry.path),
    } satisfies ExtensionToWebviewMessage)
  }

  private loadMetaPrompts() {
    const prompts = loadMetaPrompts(this.context)
    this.state.setMetaPrompts(prompts)
  }

  private async handleMessage(message: WebviewToExtensionMessage) {
    switch (message?.type) {
      case 'ready':
        this.ready = true
        this.loadMetaPrompts()
        this.postUiState()
        await this.refreshTree()
        break
      case 'toggleRespectGitignore':
        this.state.setRespectGitignore(Boolean(message.value))
        this.state.clearSelection()
        this.state.clearExpanded()
        await this.refreshTree()
        break
      case 'selectionChanged':
        this.state.setSelection(message.paths)
        void this.postSelectionSummary()
        break
      case 'expandedChanged':
        this.state.setExpanded(message.paths)
        break
      case 'promptChanged':
        this.state.setPrompt(message.value)
        break
      case 'includePromptChanged':
        this.state.setIncludePrompt(Boolean(message.value))
        break
      case 'includeSavedPromptsChanged':
        this.state.setIncludeSavedPrompts(Boolean(message.value))
        break
      case 'includeFilesChanged':
        this.state.setIncludeFiles(Boolean(message.value))
        break
      case 'setSelectedMetaPrompts':
        this.state.setSelectedMetaPromptIds(message.ids)
        this.postUiState()
        break
      case 'setViewMode':
        this.state.setViewMode(message.mode)
        this.postUiState()
        break
      case 'createMetaPrompt':
        await this.persistMetaPrompts(() => addMetaPrompt(this.context, message.name, message.body))
        break
      case 'updateMetaPrompt':
        await this.persistMetaPrompts(() =>
          updateMetaPrompt(this.context, message.id, message.name, message.body)
        )
        break
      case 'deleteMetaPrompt':
        await this.persistMetaPrompts(() => deleteMetaPrompt(this.context, message.id))
        break
      case 'requestCopy':
        this.state.setPrompt(message.prompt)
        if (message.includePrompt !== undefined) {
          this.state.setIncludePrompt(Boolean(message.includePrompt))
        }
        if (message.includeSavedPrompts !== undefined) {
          this.state.setIncludeSavedPrompts(Boolean(message.includeSavedPrompts))
        }
        if (message.includeFiles !== undefined) {
          this.state.setIncludeFiles(Boolean(message.includeFiles))
        }
        if (Array.isArray(message.metaPromptIds)) {
          this.state.setSelectedMetaPromptIds(message.metaPromptIds)
        }
        this.postUiState()
        await copySelection(this.state, this.getWebview(), {
          prompt: message.prompt ?? this.state.getPrompt(),
          includePrompt:
            message.includePrompt !== undefined
              ? Boolean(message.includePrompt)
              : this.state.getIncludePrompt(),
          includeSavedPrompts:
            message.includeSavedPrompts !== undefined
              ? Boolean(message.includeSavedPrompts)
              : this.state.getIncludeSavedPrompts(),
          includeFiles:
            message.includeFiles !== undefined
              ? Boolean(message.includeFiles)
              : this.state.getIncludeFiles(),
        })
        break
      case 'requestRefresh':
        await this.refreshTree()
        break
      case 'openFile':
        await this.openFile(message.path)
        break
      case 'requestChildren':
        await this.handleRequestChildren(message.path)
        break
    }
  }

  private async applyTreeData(data: TreeData) {
    if (!this.view) {
      return
    }
    await this.iconManager.ensureLoaded()
    this.updateLocalResourceRoots()
    this.state.setFiles(data.files)
    this.state.pruneExpandedWithNodes(data.nodes)
    const nodes = this.prepareNodesForWebview(data.nodes)
    this.view.webview.postMessage({
      type: 'treeData',
      nodes,
      selection: this.state.getSelectionEntries().map(entry => entry.path),
      respectGitignore: this.state.respectGitignore,
      prompt: this.state.getPrompt(),
      includePrompt: this.state.getIncludePrompt(),
      includeSavedPrompts: this.state.getIncludeSavedPrompts(),
      includeFiles: this.state.getIncludeFiles(),
      expanded: this.state.getExpandedPaths(),
    } satisfies ExtensionToWebviewMessage)
    void this.postSelectionSummary()
  }

  private async postSelectionSummary() {
    if (!this.view || !this.ready) {
      return
    }
    const summary = await this.state.getSelectionSummary()
    this.view.webview.postMessage({
      type: 'selectionSummary',
      summary,
    } satisfies ExtensionToWebviewMessage)
  }

  private updateLocalResourceRoots() {
    if (!this.view) {
      return
    }
    const baseRoots = new Map<string, vscode.Uri>()
    const pushRoot = (uri: vscode.Uri) => {
      baseRoots.set(uri.toString(), uri)
    }
    pushRoot(this.context.extensionUri)
    for (const root of this.iconManager.getResourceRoots()) {
      pushRoot(root)
    }
    this.view.webview.options = {
      ...this.view.webview.options,
      enableScripts: true,
      localResourceRoots: [...baseRoots.values()],
    }
  }

  private prepareNodesForWebview(nodes: WebviewNode[]) {
    const webview = this.getWebview()
    if (!webview) {
      return nodes
    }
    return nodes.map(node => this.prepareNode(webview, node))
  }

  private prepareNode(webview: vscode.Webview, node: WebviewNode): WebviewNode {
    const isRoot = !node.path.includes('/')
    const variants = this.iconManager.getIconVariants(node.path, node.type, { isRoot })
    const icon = serializeIconVariants(webview, variants)
    const children = node.children?.map(child => this.prepareNode(webview, child))
    return {
      ...node,
      icon,
      children,
    }
  }

  private postUiState() {
    if (!this.view || !this.ready) {
      return
    }
    this.view.webview.postMessage({
      type: 'uiState',
      prompt: this.state.getPrompt(),
      includePrompt: this.state.getIncludePrompt(),
      includeSavedPrompts: this.state.getIncludeSavedPrompts(),
      includeFiles: this.state.getIncludeFiles(),
      respectGitignore: this.state.respectGitignore,
      expanded: this.state.getExpandedPaths(),
      metaPrompts: this.state.getMetaPrompts(),
      selectedMetaPromptIds: this.state.getSelectedMetaPromptIds(),
      viewMode: this.state.getViewMode(),
    } satisfies ExtensionToWebviewMessage)
  }

  private async persistMetaPrompts(action: () => Promise<ReturnType<typeof loadMetaPrompts>>) {
    const prompts = await action()
    this.state.setMetaPrompts(prompts)
    this.postUiState()
  }

  private async openFile(path: string) {
    const entry = this.state.getFileEntry(path)
    if (!entry) {
      await this.refreshTree()
      return
    }
    await vscode.window.showTextDocument(entry.uri, { preview: true })
  }

  private async handleRequestChildren(displayPath: string) {
    if (!this.view) {
      return
    }
    const info = this.dirInfo.get(displayPath)
    if (!info) {
      return
    }
    const { uri, root, relative, patterns: parentPatterns } = info
    let entries: [string, vscode.FileType][]
    try {
      entries = await vscode.workspace.fs.readDirectory(uri)
    } catch {
      this.view.webview.postMessage({
        type: 'childrenLoaded',
        path: displayPath,
        children: [],
      } satisfies ExtensionToWebviewMessage)
      return
    }

    let aggPatterns = this.state.respectGitignore ? parentPatterns.slice() : []
    if (this.state.respectGitignore) {
      const hasGitignore = entries.some(
        ([name, type]) => name === '.gitignore' && (type & vscode.FileType.File) !== 0
      )
      if (hasGitignore) {
        const scoped = await this.loadGitignorePatterns(uri, relative)
        if (scoped.length) {
          aggPatterns = [...aggPatterns, ...scoped]
        }
      }
    }
    const matcher =
      this.state.respectGitignore && aggPatterns.length ? ignore().add(aggPatterns) : undefined

    const sorted = entries
      .filter(([name]) => name !== '.git')
      .sort((a, b) => {
        const aIsDir = (a[1] & vscode.FileType.Directory) !== 0
        const bIsDir = (b[1] & vscode.FileType.Directory) !== 0
        if (aIsDir !== bIsDir) {
          return aIsDir ? -1 : 1
        }
        return a[0].localeCompare(b[0])
      })

    const children: WebviewNode[] = []
    const newFiles: { path: string; uri: vscode.Uri }[] = []

    for (const [name, type] of sorted) {
      const childUri = vscode.Uri.joinPath(uri, name)
      let entryType = type
      if ((entryType & vscode.FileType.SymbolicLink) !== 0) {
        try {
          entryType = (await vscode.workspace.fs.stat(childUri)).type
        } catch {
          continue
        }
      }
      const childRelative = relative ? `${relative}/${name}` : name
      const normalized = toPosix(childRelative)
      const isIgnored = matcher
        ? matcher.ignores(normalized) || matcher.ignores(`${normalized}/`)
        : false
      if (this.state.respectGitignore && isIgnored) {
        continue
      }
      const childDisplayPath = `${displayPath}/${name}`
      if ((entryType & vscode.FileType.Directory) !== 0) {
        children.push({
          label: name,
          path: childDisplayPath,
          type: 'folder',
          ignored: Boolean(isIgnored),
          hasChildren: true,
        })
        this.dirInfo.set(childDisplayPath, {
          uri: childUri,
          root,
          relative: childRelative,
          patterns: aggPatterns,
        })
      } else if ((entryType & vscode.FileType.File) !== 0) {
        children.push({
          label: name,
          path: childDisplayPath,
          type: 'file',
          ignored: Boolean(isIgnored),
        })
        newFiles.push({ path: childDisplayPath, uri: childUri })
      }
    }

    this.state.addFiles(newFiles.map(f => ({ path: f.path, uri: f.uri })))

    const prepared = children.map(n => this.prepareNode(this.view!.webview, n))
    this.view.webview.postMessage({
      type: 'childrenLoaded',
      path: displayPath,
      children: prepared,
    } satisfies ExtensionToWebviewMessage)
    void this.postSelectionSummary()
  }

  private async refreshFileIndex(expectedToken: number) {
    try {
      const files = await collectWorkspaceFiles(this.state.respectGitignore)
      if (!this.view || expectedToken !== this.refreshToken) {
        return
      }
      this.state.setFiles(files)
      this.postFileIndex(files)
    } catch {
      if (expectedToken === this.refreshToken) {
        const empty = new Map<string, FileEntry>()
        this.state.setFiles(empty)
        this.postFileIndex(empty)
      }
    }
  }

  private async loadGitignorePatterns(directory: vscode.Uri, relativeDir: string) {
    const key = directory.toString()
    if (this.gitignoreCache.has(key)) {
      return this.gitignoreCache.get(key) ?? []
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
      this.gitignoreCache.set(key, scoped)
      return scoped
    } catch {
      this.gitignoreCache.set(key, [])
      return []
    }
  }
}

function isWebviewToExtensionMessage(msg: unknown): WebviewToExtensionMessage | undefined {
  if (!msg || typeof msg !== 'object') {
    return undefined
  }
  const type = (msg as Record<string, unknown>).type
  if (typeof type !== 'string') {
    return undefined
  }
  return msg as WebviewToExtensionMessage
}

function serializeIconVariants(
  webview: vscode.Webview,
  variants: IconThemeNodeIcon
): WebviewNodeIcon | undefined {
  const collapsed = serializeIconVariant(webview, variants.collapsed)
  const expanded = variants.expanded ? serializeIconVariant(webview, variants.expanded) : undefined
  const primary = collapsed ?? expanded
  if (!primary) {
    return undefined
  }
  const result: WebviewNodeIcon = { collapsed: primary }
  if (expanded) {
    result.expanded = expanded
  }
  return result
}

function serializeIconVariant(
  webview: vscode.Webview,
  icon: { dark?: vscode.Uri; light?: vscode.Uri; codicon?: string }
): WebviewNodeIconVariant | undefined {
  const variant: WebviewNodeIconVariant = {}
  if (icon.dark) {
    variant.dark = webview.asWebviewUri(icon.dark).toString()
  }
  if (icon.light) {
    variant.light = webview.asWebviewUri(icon.light).toString()
  }
  if (icon.codicon) {
    variant.codicon = icon.codicon
  }
  if (!variant.dark && !variant.light && !variant.codicon) {
    return undefined
  }
  return variant
}

export function registerContextKitView(context: vscode.ExtensionContext, state: ContextKitState) {
  const provider = new ContextKitViewProvider(context, state)
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider))
  return provider
}
