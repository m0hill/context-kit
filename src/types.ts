export type NodeType = 'file' | 'folder'

export interface WebviewNode {
  label: string
  path: string
  type: NodeType
  size?: number
  ignored?: boolean
  icon?: WebviewNodeIcon
  children?: WebviewNode[]
  hasChildren?: boolean
}

export interface WebviewNodeIconVariant {
  dark?: string
  light?: string
  codicon?: string
}

export interface WebviewNodeIcon {
  collapsed: WebviewNodeIconVariant
  expanded?: WebviewNodeIconVariant
}

export interface FileEntry {
  path: string
  uri: import('vscode').Uri
  size?: number
}

export interface TreeData {
  nodes: WebviewNode[]
  files: Map<string, FileEntry>
}

export interface MetaPrompt {
  id: string
  name: string
  body: string
}

export const VIEW_ID = 'contextKitView'

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'toggleRespectGitignore'; value: boolean }
  | { type: 'selectionChanged'; paths: string[] }
  | { type: 'expandedChanged'; paths: string[] }
  | { type: 'promptChanged'; value: string }
  | { type: 'includePromptChanged'; value: boolean }
  | { type: 'includeSavedPromptsChanged'; value: boolean }
  | { type: 'includeFilesChanged'; value: boolean }
  | { type: 'setSelectedMetaPrompts'; ids: string[] }
  | { type: 'setViewMode'; mode: 'main' | 'manage' }
  | { type: 'createMetaPrompt'; name: string; body: string }
  | { type: 'updateMetaPrompt'; id: string; name: string; body: string }
  | { type: 'deleteMetaPrompt'; id: string }
  | {
      type: 'requestCopy'
      prompt: string
      includePrompt?: boolean
      includeSavedPrompts?: boolean
      includeFiles?: boolean
      metaPromptIds?: string[]
    }
  | { type: 'requestRefresh' }
  | { type: 'openFile'; path: string }
  | { type: 'requestChildren'; path: string }

export type ExtensionToWebviewMessage =
  | { type: 'loading' }
  | {
      type: 'treeData'
      nodes: WebviewNode[]
      selection: string[]
      respectGitignore: boolean
      prompt: string
      includePrompt: boolean
      includeSavedPrompts: boolean
      includeFiles: boolean
      expanded: string[]
    }
  | { type: 'fileIndex'; files: string[] }
  | { type: 'childrenLoaded'; path: string; children: WebviewNode[] }
  | {
      type: 'uiState'
      prompt: string
      includePrompt: boolean
      includeSavedPrompts: boolean
      includeFiles: boolean
      respectGitignore: boolean
      expanded: string[]
      metaPrompts: MetaPrompt[]
      selectedMetaPromptIds: string[]
      viewMode: 'main' | 'manage'
    }
  | { type: 'selectionSummary'; summary: { count: number; tokenCount: number } }
  | { type: 'warning'; text?: string }
  | { type: 'status'; text?: string; level?: 'info' | 'warning' }
  | { type: 'noWorkspace' }
