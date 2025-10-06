import { Buffer } from 'buffer'
import * as vscode from 'vscode'

import { inferLanguage, splitPathSegments, toPosix } from './utils'

type NodeKind = 'file' | 'folder'

interface IconDefinition {
  readonly iconPath?: string
}

interface IconThemeDocument {
  readonly iconDefinitions?: Record<string, IconDefinition | undefined>
  readonly file?: string
  readonly folder?: string
  readonly folderExpanded?: string
  readonly rootFolder?: string
  readonly rootFolderExpanded?: string
  readonly fileNames?: Record<string, string | undefined>
  readonly fileExtensions?: Record<string, string | undefined>
  readonly folderNames?: Record<string, string | undefined>
  readonly folderNamesExpanded?: Record<string, string | undefined>
  readonly languageIds?: Record<string, string | undefined>
  readonly light?: IconThemeDocument
}

interface IconThemeContribution {
  readonly id: string
  readonly path: string
}

export interface ResolvedIcon {
  readonly dark?: vscode.Uri
  readonly light?: vscode.Uri
  readonly codicon?: string
}

interface ResolveOptions {
  readonly expanded?: boolean
  readonly isRoot?: boolean
}

export interface IconThemeNodeIcon {
  readonly collapsed: ResolvedIcon
  readonly expanded?: ResolvedIcon
}

export class IconThemeManager {
  private loaded = false
  private baseDoc?: IconThemeDocument
  private lightDoc?: IconThemeDocument
  private baseDir?: vscode.Uri
  private themeExtensionUri?: vscode.Uri
  private baseIconUris = new Map<string, vscode.Uri>()
  private lightIconUris = new Map<string, vscode.Uri>()
  private fallbackFileCodicon = 'codicon-file'
  private fallbackFolderCodicon = 'codicon-folder'

  async ensureLoaded() {
    if (this.loaded) {
      return
    }
    await this.loadTheme()
  }

  reset() {
    this.loaded = false
    this.baseDoc = undefined
    this.lightDoc = undefined
    this.baseDir = undefined
    this.themeExtensionUri = undefined
    this.baseIconUris.clear()
    this.lightIconUris.clear()
  }

  getResourceRoots() {
    const roots: vscode.Uri[] = []
    if (this.baseDir) {
      roots.push(this.baseDir)
    }
    if (this.themeExtensionUri) {
      roots.push(this.themeExtensionUri)
    }
    return roots
  }

  async reload() {
    this.reset()
    await this.ensureLoaded()
  }

  getIconVariants(path: string, kind: NodeKind, options: ResolveOptions = {}): IconThemeNodeIcon {
    if (!this.loaded || !this.baseDoc) {
      const fallback = this.defaultIcon(kind)
      return { collapsed: fallback, expanded: kind === 'folder' ? fallback : undefined }
    }
    const name = extractName(path)
    if (!name) {
      const fallback = this.defaultIcon(kind)
      return { collapsed: fallback, expanded: kind === 'folder' ? fallback : undefined }
    }
    if (kind === 'file') {
      return { collapsed: this.resolveVariant(kind, name, options) }
    }
    const collapsed = this.resolveVariant('folder', name, { ...options, expanded: false })
    const expanded = this.resolveVariant('folder', name, { ...options, expanded: true })
    return { collapsed, expanded }
  }

  private defaultIcon(kind: NodeKind): ResolvedIcon {
    return { codicon: kind === 'folder' ? this.fallbackFolderCodicon : this.fallbackFileCodicon }
  }

  private resolveVariant(kind: NodeKind, name: string, options: ResolveOptions): ResolvedIcon {
    const darkId = this.resolveIconId(this.baseDoc, kind, name, options)
    const lightDoc = this.lightDoc ?? this.baseDoc
    const lightId = this.resolveIconId(lightDoc, kind, name, options) ?? darkId
    const darkUri = this.resolveIconUri(darkId, this.baseIconUris)
    const lightUri = this.resolveIconUri(lightId, this.lightIconUris, this.baseIconUris)
    if (!darkUri && !lightUri) {
      return this.defaultIcon(kind)
    }
    return { dark: darkUri, light: lightUri ?? darkUri }
  }

  private async loadTheme() {
    try {
      const theme = await this.resolveCurrentTheme()
      if (!theme) {
        this.loaded = true
        return
      }
      const { contribution, extension } = theme
      const themeUri = vscode.Uri.joinPath(extension.extensionUri, contribution.path)
      const baseDir = vscode.Uri.joinPath(themeUri, '..')
      const content = await vscode.workspace.fs.readFile(themeUri)
      const baseDoc = parseTheme(content)
      if (!baseDoc) {
        this.loaded = true
        return
      }
      const lightDoc = baseDoc.light ? mergeDocumentOverrides(baseDoc, baseDoc.light) : undefined
      this.themeExtensionUri = extension.extensionUri
      this.baseDir = baseDir
      this.baseDoc = baseDoc
      this.lightDoc = lightDoc
      this.baseIconUris = buildDefinitionMap(baseDir, baseDoc.iconDefinitions)
      this.lightIconUris = lightDoc
        ? buildDefinitionMap(baseDir, lightDoc.iconDefinitions)
        : new Map()
      this.loaded = true
    } catch (error) {
      console.error('[ContextKit] Failed to load icon theme', error)
      this.reset()
      this.loaded = true
    }
  }

  private async resolveCurrentTheme(): Promise<
    | {
        contribution: IconThemeContribution
        extension: vscode.Extension<unknown>
      }
    | undefined
  > {
    const themeId = vscode.workspace.getConfiguration('workbench').get<string>('iconTheme')
    if (!themeId) {
      return undefined
    }
    for (const extension of vscode.extensions.all) {
      const contributes = extension.packageJSON?.contributes
      const iconThemes: IconThemeContribution[] | undefined = contributes?.iconThemes
      if (!Array.isArray(iconThemes)) {
        continue
      }
      for (const contribution of iconThemes) {
        if (contribution?.id === themeId && contribution.path) {
          return { contribution, extension }
        }
      }
    }
    return undefined
  }

  private resolveIconId(
    doc: IconThemeDocument | undefined,
    kind: NodeKind,
    name: string,
    options: ResolveOptions
  ): string | undefined {
    if (!doc) {
      return undefined
    }
    if (kind === 'file') {
      return this.resolveFileIconId(doc, name)
    }
    return this.resolveFolderIconId(doc, name, options)
  }

  private resolveFileIconId(doc: IconThemeDocument, name: string): string | undefined {
    const lowerName = name.toLowerCase()
    const fileNames = doc.fileNames ?? {}

    const loweredFileNames: Record<string, string> = {}
    for (const [key, value] of Object.entries(fileNames)) {
      if (value) {
        loweredFileNames[key.toLowerCase()] = value
      }
    }
    const directId = loweredFileNames[lowerName]
    if (directId) {
      return directId
    }

    const extId = findByExtension(name, doc.fileExtensions ?? {}, false)
    if (extId) {
      return extId
    }

    const langId = inferLanguage(name)
    if (langId) {
      const langIconId = doc.languageIds?.[langId.toLowerCase()]
      if (langIconId) {
        return langIconId
      }
    }

    return doc.file
  }

  private resolveFolderIconId(
    doc: IconThemeDocument,
    name: string,
    options: ResolveOptions
  ): string | undefined {
    const lower = name.toLowerCase()
    const expanded = Boolean(options.expanded)
    const isRoot = Boolean(options.isRoot)
    if (isRoot) {
      if (expanded) {
        return doc.rootFolderExpanded ?? doc.folderExpanded ?? doc.rootFolder ?? doc.folder
      }
      return doc.rootFolder ?? doc.folder
    }
    if (expanded) {
      const byName = doc.folderNamesExpanded?.[lower]
      if (byName) {
        return byName
      }
      return doc.folderExpanded ?? doc.folder
    }
    const byName = doc.folderNames?.[lower]
    if (byName) {
      return byName
    }
    return doc.folder ?? doc.folderExpanded
  }

  private resolveIconUri(
    id: string | undefined,
    primary: Map<string, vscode.Uri>,
    fallback?: Map<string, vscode.Uri>
  ): vscode.Uri | undefined {
    if (!id) {
      return undefined
    }
    return primary.get(id) ?? fallback?.get(id)
  }
}

function parseTheme(buffer: Uint8Array): IconThemeDocument | undefined {
  try {
    const text = Buffer.from(buffer).toString('utf8')
    const data = JSON.parse(text)
    return data as IconThemeDocument
  } catch (error) {
    console.error('[ContextKit] Failed to parse icon theme', error)
    return undefined
  }
}

function buildDefinitionMap(
  baseDir: vscode.Uri,
  definitions?: Record<string, IconDefinition | undefined>
) {
  const map = new Map<string, vscode.Uri>()
  if (!definitions) {
    return map
  }
  for (const [id, definition] of Object.entries(definitions)) {
    if (!id || !definition?.iconPath) {
      continue
    }
    const uri = resolveIconUri(baseDir, definition.iconPath)
    map.set(id, uri)
  }
  return map
}

function resolveIconUri(baseDir: vscode.Uri, relativePath: string) {
  const cleaned = toPosix(relativePath)
  const segments = splitPathSegments(cleaned)
  return vscode.Uri.joinPath(baseDir, ...segments)
}

function mergeDocumentOverrides(
  base: IconThemeDocument,
  overrides: IconThemeDocument
): IconThemeDocument {
  const { light: _baseLight, ...baseRest } = base
  const { light: _overrideLight, ...overrideRest } = overrides
  return {
    ...baseRest,
    ...overrideRest,
    iconDefinitions: {
      ...(base.iconDefinitions ?? {}),
      ...(overrides.iconDefinitions ?? {}),
    },
  }
}

function extractName(path: string) {
  const normalized = path.trim()
  if (!normalized) {
    return ''
  }
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

function findByExtension(
  name: string,
  table: Record<string, string | undefined>,
  caseSensitive: boolean
) {
  const loweredTable: Record<string, string | undefined> = {}
  if (!caseSensitive) {
    for (const [key, value] of Object.entries(table)) {
      loweredTable[key.toLowerCase()] = value
    }
  } else {
    Object.assign(loweredTable, table)
  }
  const parts = name.split('.')
  if (parts.length <= 1) {
    return undefined
  }
  for (let i = 1; i < parts.length; i += 1) {
    const ext = parts.slice(i).join('.')
    const key = caseSensitive ? ext : ext.toLowerCase()
    if (loweredTable[key]) {
      return loweredTable[key]
    }
  }
  return undefined
}
