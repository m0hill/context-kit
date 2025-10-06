// @ts-nocheck
import './style.css'

const vscode = acquireVsCodeApi()
let treeData = []
let selected = new Set()
let expanded = new Set()
const loadingChildren = new Set()
const pendingSelect = new Map()
let filter = ''
let promptValue = ''
let includePrompt = true
let includeSavedPrompts = true
let includeFiles = true
let respectGitignoreEnabled = true
const themedIconImages = new Set()
let themedIconSources = new WeakMap()
const themeObserver = new MutationObserver(() => updateAllThemedIcons())
themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
let metaPrompts = []
let selectedMetaPromptIds = new Set()
let viewMode = 'main'
let manageStatusTimer = null
let editingMetaPromptId = null

const headerTitle = document.getElementById('headerTitle')
const searchInput = document.getElementById('search')
const treeRoot = document.getElementById('tree')
const respectToggle = document.getElementById('respectGitignore')
const copyButton = document.getElementById('copyButton')
const selectionInfo = document.getElementById('selectionInfo')
const statusEl = document.getElementById('statusMessage')
const selectAllCheckbox = document.getElementById('selectAll')
const refreshButton = document.getElementById('refreshTree')
const promptInput = document.getElementById('promptInput')
const includePromptCheckbox = document.getElementById('includePrompt')
const includeSavedPromptsCheckbox = document.getElementById('includeSavedPrompts')
const includeFilesCheckbox = document.getElementById('includeFiles')
const metaPromptList = document.getElementById('metaPromptList')
const toggleViewBtn = document.getElementById('toggleView')
const settingsIcon = document.getElementById('settingsIcon')
const backIcon = document.getElementById('backIcon')
const mainView = document.getElementById('mainView')
const manageView = document.getElementById('manageView')
const manageForm = document.getElementById('metaPromptForm')
const manageNameInput = document.getElementById('metaPromptName')
const manageBodyInput = document.getElementById('metaPromptBody')
const manageStatusEl = document.getElementById('manageStatus')
const managePromptList = document.getElementById('managePromptList')
const metaPromptCancel = document.getElementById('metaPromptCancel')
const metaPromptSave = document.getElementById('metaPromptSave')
includePrompt = Boolean(includePromptCheckbox?.checked ?? includePrompt)
includeSavedPrompts = Boolean(includeSavedPromptsCheckbox?.checked ?? includeSavedPrompts)
includeFiles = Boolean(includeFilesCheckbox?.checked ?? includeFiles)
applyRespectGitignoreState(Boolean(respectToggle?.checked ?? true))
let statusTimer = null

function setPromptFromState(value) {
  if (typeof value !== 'string') {
    return
  }
  promptValue = value
  if (promptInput) {
    promptInput.value = promptValue
  }
}

function setIncludeFromState(value) {
  if (value === undefined) {
    return
  }
  includePrompt = Boolean(value)
  if (includePromptCheckbox) {
    includePromptCheckbox.checked = includePrompt
  }
}

function setIncludeSavedPromptsFromState(value) {
  if (value === undefined) {
    return
  }
  includeSavedPrompts = Boolean(value)
  if (includeSavedPromptsCheckbox) {
    includeSavedPromptsCheckbox.checked = includeSavedPrompts
  }
}

function setIncludeFilesFromState(value) {
  if (value === undefined) {
    return
  }
  includeFiles = Boolean(value)
  if (includeFilesCheckbox) {
    includeFilesCheckbox.checked = includeFiles
  }
}

function setStatus(text, level = 'info') {
  if (!statusEl) {
    return
  }
  statusEl.textContent = text ?? ''
  statusEl.classList.remove('warning', 'info')
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
  if (text) {
    statusEl.classList.add(level === 'warning' ? 'warning' : 'info')
    statusTimer = setTimeout(() => {
      statusEl.textContent = ''
      statusEl.classList.remove('warning', 'info')
      statusTimer = null
    }, 3000)
  }
}

function setManageStatus(text, level = 'info') {
  if (!manageStatusEl) {
    return
  }
  manageStatusEl.textContent = text ?? ''
  manageStatusEl.classList.remove('warning', 'info')
  if (manageStatusTimer) {
    clearTimeout(manageStatusTimer)
    manageStatusTimer = null
  }
  if (text) {
    manageStatusEl.classList.add(level === 'warning' ? 'warning' : 'info')
    manageStatusTimer = setTimeout(() => {
      manageStatusEl.textContent = ''
      manageStatusEl.classList.remove('warning', 'info')
      manageStatusTimer = null
    }, 3000)
  }
}

function flatten(nodes) {
  const map = new Map()
  const visit = node => {
    if (node.type === 'file') {
      map.set(node.path, node)
    }
    node.children?.forEach(visit)
  }
  nodes.forEach(visit)
  return map
}

function collectFiles(node) {
  if (node.type === 'file') {
    return [node]
  }
  return node.children?.flatMap(collectFiles) ?? []
}

function hasLoadedChildren(node) {
  return Array.isArray(node.children) && node.children.length > 0
}

function requestChildrenForPath(path) {
  if (loadingChildren.has(path)) {
    return
  }
  loadingChildren.add(path)
  vscode.postMessage({ type: 'requestChildren', path })
}

function scheduleSelectionForFolder(path, checked) {
  pendingSelect.set(path, !!checked)
  requestChildrenForPath(path)
}

function ensureFolderSelection(node, checked) {
  if (node.type !== 'folder') {
    return
  }
  if (!hasLoadedChildren(node)) {
    if (node.hasChildren !== false) {
      scheduleSelectionForFolder(node.path, checked)
    }
    return
  }
  for (const child of node.children ?? []) {
    if (child.type !== 'folder') {
      continue
    }
    if (!hasLoadedChildren(child)) {
      if (child.hasChildren !== false) {
        scheduleSelectionForFolder(child.path, checked)
      }
      continue
    }
    ensureFolderSelection(child, checked)
  }
}

function findNodeByPath(nodes, path) {
  for (const node of nodes) {
    if (node.path === path) {
      return node
    }
    if (node.children) {
      const found = findNodeByPath(node.children, path)
      if (found) {
        return found
      }
    }
  }
  return null
}

function nodeMatches(node, term) {
  if (node.label.toLowerCase().includes(term) || node.path.toLowerCase().includes(term)) {
    return true
  }
  return node.children?.some(child => nodeMatches(child, term)) ?? false
}

function filterNodes(nodes, term) {
  return nodes
    .map(node => {
      if (!term) {
        return node
      }
      if (!nodeMatches(node, term)) {
        return null
      }
      if (node.children) {
        return {
          ...node,
          children: filterNodes(node.children, term).filter(Boolean),
        }
      }
      return node
    })
    .filter(Boolean)
}

function getVisibleFilePaths() {
  const visibleNodes = filterNodes(treeData, filter)
  const paths = []
  const visit = nodes => {
    nodes.forEach(node => {
      if (node.type === 'file') {
        paths.push(node.path)
      }
      node.children && visit(node.children)
    })
  }
  visit(visibleNodes)
  return paths
}

function updateSelectAllCheckbox() {
  if (!selectAllCheckbox) {
    return
  }
  const visiblePaths = getVisibleFilePaths()
  const hasVisibleFiles = visiblePaths.length > 0
  selectAllCheckbox.disabled = !hasVisibleFiles
  if (!hasVisibleFiles) {
    selectAllCheckbox.checked = false
    selectAllCheckbox.indeterminate = false
    return
  }
  const selectedCount = visiblePaths.filter(path => selected.has(path)).length
  const allSelected = selectedCount === visiblePaths.length
  const someSelected = selectedCount > 0 && selectedCount < visiblePaths.length
  selectAllCheckbox.checked = allSelected
  selectAllCheckbox.indeterminate = someSelected
}

function pruneExpanded(nodes) {
  const available = new Set()
  const visit = node => {
    if (node.type === 'folder') {
      available.add(node.path)
      node.children?.forEach(visit)
    }
  }
  nodes.forEach(visit)
  expanded = new Set([...expanded].filter(path => available.has(path)))
}

function sendExpandedState() {
  vscode.postMessage({ type: 'expandedChanged', paths: [...expanded] })
}

function isNodeFullySelected(node) {
  if (node.type === 'file') {
    return selected.has(node.path)
  }
  const files = collectFiles(node)
  return files.length > 0 && files.every(file => selected.has(file.path))
}

function isNodePartiallySelected(node) {
  if (node.type === 'file') {
    return false
  }
  const files = collectFiles(node)
  return (
    files.some(file => selected.has(file.path)) && !files.every(file => selected.has(file.path))
  )
}

function toggleNode(node, checked) {
  if (node.type === 'file') {
    if (checked) {
      selected.add(node.path)
    } else {
      selected.delete(node.path)
    }
    vscode.postMessage({ type: 'selectionChanged', paths: [...selected] })
    refreshTree()
    return
  }
  const files = collectFiles(node)
  files.forEach(file => {
    if (checked) {
      selected.add(file.path)
    } else {
      selected.delete(file.path)
    }
  })
  ensureFolderSelection(node, checked)
  vscode.postMessage({ type: 'selectionChanged', paths: [...selected] })
  refreshTree()
}

function toggleFolder(node) {
  const path = node.path
  if (expanded.has(path)) {
    expanded.delete(path)
    refreshTree()
    sendExpandedState()
    return
  }
  expanded.add(path)
  if (node.type === 'folder' && !node.children && node.hasChildren !== false) {
    requestChildrenForPath(path)
  }
  refreshTree()
  sendExpandedState()
}

function openFile(path) {
  vscode.postMessage({ type: 'openFile', path })
}

function applyRespectGitignoreState(enabled) {
  respectGitignoreEnabled = !!enabled
  if (treeRoot) {
    treeRoot.classList.toggle('gitignore-disabled', !respectGitignoreEnabled)
  }
}

function setRefreshLoading(isLoading) {
  if (!refreshButton) {
    return
  }
  refreshButton.disabled = Boolean(isLoading)
}

function getNodeIconVariant(node, isExpanded) {
  const icon = node.icon
  if (!icon) {
    return null
  }
  if (isExpanded && icon.expanded) {
    return icon.expanded
  }
  return icon.collapsed ?? icon.expanded ?? null
}

function applyNodeIcon(container, node, isExpanded) {
  container.innerHTML = ''
  const variant = getNodeIconVariant(node, isExpanded)
  if (!variant) {
    container.classList.add('tree-icon-placeholder')
    return
  }
  container.classList.remove('tree-icon-placeholder')
  if (variant.codicon) {
    const fallback = createFallbackIcon(variant.codicon)
    if (fallback) {
      container.appendChild(fallback)
      return
    }
  }
  const img = document.createElement('img')
  img.alt = ''
  img.draggable = false
  container.appendChild(img)
  registerThemedIcon(img, variant)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function createFallbackIcon(name) {
  switch (name) {
    case 'codicon-folder':
    case 'codicon-root-folder':
      return createFolderFallbackIcon()
    case 'codicon-file':
      return createFileFallbackIcon()
    default:
      return null
  }
}

function createFolderFallbackIcon() {
  const svg = createSvgBase()
  const tab = document.createElementNS(SVG_NS, 'path')
  tab.setAttribute('d', 'M1.5 5L1.5 3.9 2.4 3h3.2L6.7 4H14.5V5Z')
  tab.setAttribute('fill', 'currentColor')
  tab.setAttribute('fill-opacity', '0.85')
  svg.appendChild(tab)
  const body = document.createElementNS(SVG_NS, 'rect')
  body.setAttribute('x', '1.5')
  body.setAttribute('y', '5')
  body.setAttribute('width', '13')
  body.setAttribute('height', '7.5')
  body.setAttribute('rx', '1')
  body.setAttribute('fill', 'currentColor')
  svg.appendChild(body)
  return svg
}

function createFileFallbackIcon() {
  const svg = createSvgBase()
  const page = document.createElementNS(SVG_NS, 'rect')
  page.setAttribute('x', '4')
  page.setAttribute('y', '2.5')
  page.setAttribute('width', '7.5')
  page.setAttribute('height', '11')
  page.setAttribute('rx', '1')
  page.setAttribute('fill', 'currentColor')
  svg.appendChild(page)
  const fold = document.createElementNS(SVG_NS, 'path')
  fold.setAttribute('d', 'M8.5 2.5H11.5L11.5 5.5Z')
  fold.setAttribute('fill', 'currentColor')
  fold.setAttribute('fill-opacity', '0.7')
  svg.appendChild(fold)
  return svg
}

function createSvgBase() {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('role', 'presentation')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('aria-hidden', 'true')
  return svg
}

function registerThemedIcon(img, variant) {
  if (!variant.dark && !variant.light) {
    return
  }
  themedIconSources.set(img, { dark: variant.dark, light: variant.light })
  themedIconImages.add(img)
  updateThemedIconImage(img)
}

function updateThemedIconImage(img) {
  const source = themedIconSources.get(img)
  if (!source) {
    return
  }
  const theme = getCurrentThemeVariant()
  const nextSrc = theme === 'light' && source.light ? source.light : (source.dark ?? source.light)
  if (nextSrc) {
    if (img.getAttribute('src') !== nextSrc) {
      img.setAttribute('src', nextSrc)
    }
    img.classList.remove('hidden')
  } else {
    img.classList.add('hidden')
  }
}

function updateAllThemedIcons() {
  themedIconImages.forEach(img => updateThemedIconImage(img))
}

function getCurrentThemeVariant() {
  const classList = document.body.classList
  if (classList.contains('vscode-high-contrast-light')) {
    return 'light'
  }
  if (classList.contains('vscode-light')) {
    return 'light'
  }
  return 'dark'
}

function renderNode(node) {
  const matches = filter ? nodeMatches(node, filter) : true
  if (!matches) {
    return document.createDocumentFragment()
  }
  const container = document.createElement('div')
  container.className = 'tree-node'
  const item = document.createElement('div')
  item.className = 'tree-item'
  const isFolder = node.type === 'folder'
  const canExpand = isFolder && node.hasChildren !== false
  const expandedState = isFolder ? (filter ? true : expanded.has(node.path)) : false
  if (!respectGitignoreEnabled && node.ignored) {
    item.classList.add('ignored')
  }
  const expander = document.createElement('span')
  expander.className = 'expander'
  if (canExpand) {
    expander.textContent = '›'
    if (expandedState) {
      expander.classList.add('expanded')
    }
    expander.addEventListener('click', event => {
      event.stopPropagation()
      toggleFolder(node)
    })
  } else {
    expander.classList.add('hidden')
  }
  item.appendChild(expander)
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = isNodeFullySelected(node)
  checkbox.indeterminate =
    node.type === 'folder' && !checkbox.checked && isNodePartiallySelected(node)
  checkbox.addEventListener('click', event => event.stopPropagation())
  checkbox.addEventListener('change', () => toggleNode(node, checkbox.checked))
  item.appendChild(checkbox)
  const iconSlot = document.createElement('span')
  iconSlot.className = 'tree-icon'
  applyNodeIcon(iconSlot, node, expandedState)
  item.appendChild(iconSlot)
  const label = document.createElement('span')
  label.textContent = node.label
  label.className = 'label ' + (node.type === 'folder' ? 'folder' : 'file')
  if (node.type === 'folder') {
    label.addEventListener('click', event => {
      event.stopPropagation()
      toggleFolder(node)
    })
  } else {
    label.addEventListener('click', event => {
      event.stopPropagation()
      openFile(node.path)
    })
  }
  item.appendChild(label)
  container.appendChild(item)
  const shouldShowChildren = isFolder && (filter ? true : expanded.has(node.path))
  if (shouldShowChildren) {
    if (isFolder && (!node.children || !node.children.length) && node.hasChildren !== false) {
      requestChildrenForPath(node.path)
    }
    const childrenContainer = document.createElement('div')
    childrenContainer.className = 'tree-children'
    if (node.children && node.children.length) {
      node.children.forEach(child => {
        const rendered = renderNode(child)
        if (rendered && rendered.childNodes.length) {
          childrenContainer.appendChild(rendered)
        }
      })
    } else if (loadingChildren.has(node.path)) {
      const loading = document.createElement('div')
      loading.className = 'message info'
      loading.textContent = 'Loading...'
      childrenContainer.appendChild(loading)
    }
    if (childrenContainer.childNodes.length) {
      container.appendChild(childrenContainer)
    }
  }
  return container
}

function refreshTree() {
  if (!treeRoot) {
    return
  }
  themedIconImages.clear()
  themedIconSources = new WeakMap()
  treeRoot.innerHTML = ''
  if (!treeData.length) {
    treeRoot.innerHTML = '<div class="message">No files found.</div>'
    updateSelectAllCheckbox()
    return
  }
  treeData.forEach(node => treeRoot.appendChild(renderNode(node)))
  updateSelectAllCheckbox()
}

function toggleSelectAll(checked) {
  const visiblePaths = getVisibleFilePaths()
  if (!visiblePaths.length) {
    return
  }
  visiblePaths.forEach(path => {
    if (checked) {
      selected.add(path)
    } else {
      selected.delete(path)
    }
  })
  vscode.postMessage({ type: 'selectionChanged', paths: [...selected] })
  refreshTree()
}

function renderMetaPromptList() {
  if (!metaPromptList) {
    return
  }
  metaPromptList.innerHTML = ''
  metaPromptList.classList.remove('message', 'info')
  if (!metaPrompts.length) {
    metaPromptList.classList.add('message', 'info')
    metaPromptList.textContent = 'No saved prompts'
    return
  }
  metaPrompts.forEach(prompt => {
    const label = document.createElement('label')
    label.className = 'meta-option'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = selectedMetaPromptIds.has(prompt.id)
    checkbox.addEventListener('change', () =>
      toggleMetaPromptSelection(prompt.id, checkbox.checked)
    )
    const span = document.createElement('span')
    span.textContent = prompt.name
    label.appendChild(checkbox)
    label.appendChild(span)
    metaPromptList.appendChild(label)
  })
}

function renderManagePromptList() {
  if (!managePromptList) {
    return
  }
  managePromptList.innerHTML = ''
  if (!metaPrompts.length) {
    const empty = document.createElement('div')
    empty.className = 'message info'
    empty.textContent = 'No saved prompts yet.'
    managePromptList.appendChild(empty)
    return
  }
  metaPrompts.forEach(prompt => {
    const details = document.createElement('details')
    details.className = 'manage-item'
    if (prompt.id === editingMetaPromptId) {
      details.open = true
    }
    const summary = document.createElement('summary')
    const titleSpan = document.createElement('span')
    titleSpan.className = 'title'
    titleSpan.textContent = prompt.name
    summary.appendChild(titleSpan)
    const actions = document.createElement('div')
    actions.className = 'actions'
    const editBtn = document.createElement('button')
    editBtn.type = 'button'
    editBtn.className = 'icon-button'
    editBtn.title = 'Edit prompt'
    editBtn.setAttribute('aria-label', 'Edit prompt')
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true"><path d="M18 2L22 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M7.5 20.5L19 9L15 5L3.5 16.5L2 22L7.5 20.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
    editBtn.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      startMetaPromptEdit(prompt.id)
    })
    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className = 'icon-button'
    deleteBtn.title = 'Delete prompt'
    deleteBtn.setAttribute('aria-label', 'Delete prompt')
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true"><path d="M3 6H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M19 6V20C19 21 18 22 17 22H7C6 22 5 21 5 20V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M8 6V4C8 3 9 2 10 2H14C15 2 16 3 16 4V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M10 11V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M14 11V17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
    deleteBtn.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      requestDeleteMetaPrompt(prompt.id)
    })
    actions.appendChild(editBtn)
    actions.appendChild(deleteBtn)
    summary.appendChild(actions)
    details.appendChild(summary)
    const body = document.createElement('pre')
    body.textContent = prompt.body || ''
    details.appendChild(body)
    managePromptList.appendChild(details)
  })
}

function toggleMetaPromptSelection(id, checked) {
  if (checked) {
    selectedMetaPromptIds.add(id)
  } else {
    selectedMetaPromptIds.delete(id)
  }
  vscode.postMessage({ type: 'setSelectedMetaPrompts', ids: [...selectedMetaPromptIds] })
}

function setSelectedMetaPromptIdsFromState(ids) {
  selectedMetaPromptIds = new Set(Array.isArray(ids) ? ids : [])
  renderMetaPromptList()
}

function setMetaPromptsFromState(list) {
  metaPrompts = Array.isArray(list) ? list : []
  const available = new Set(metaPrompts.map(prompt => prompt.id))
  selectedMetaPromptIds = new Set([...selectedMetaPromptIds].filter(id => available.has(id)))
  renderMetaPromptList()
  renderManagePromptList()
  if (editingMetaPromptId) {
    const current = metaPrompts.find(prompt => prompt.id === editingMetaPromptId)
    if (!current) {
      resetMetaPromptForm()
    } else {
      if (manageNameInput) {
        manageNameInput.value = current.name
      }
      if (manageBodyInput) {
        manageBodyInput.value = current.body
      }
    }
  }
}

function requestDeleteMetaPrompt(id) {
  if (editingMetaPromptId === id) {
    resetMetaPromptForm()
  }
  vscode.postMessage({ type: 'deleteMetaPrompt', id })
  setManageStatus('Deleting prompt...', 'info')
}

function startMetaPromptEdit(id) {
  const prompt = metaPrompts.find(item => item.id === id)
  if (!prompt || !manageNameInput || !manageBodyInput) {
    return
  }
  editingMetaPromptId = id
  manageNameInput.value = prompt.name
  manageBodyInput.value = prompt.body
  metaPromptCancel?.classList.remove('hidden')
  if (metaPromptSave) {
    metaPromptSave.textContent = 'Update'
  }
  renderManagePromptList()
  setManageStatus('Editing "' + prompt.name + '"', 'info')
}

function resetMetaPromptForm(clearStatus = true) {
  editingMetaPromptId = null
  if (manageNameInput) {
    manageNameInput.value = ''
  }
  if (manageBodyInput) {
    manageBodyInput.value = ''
  }
  metaPromptCancel?.classList.add('hidden')
  if (metaPromptSave) {
    metaPromptSave.textContent = 'Save prompt'
  }
  if (clearStatus) {
    setManageStatus('')
  }
  renderManagePromptList()
}

function applyViewMode(mode) {
  viewMode = mode === 'manage' ? 'manage' : 'main'
  mainView?.classList.toggle('hidden', viewMode !== 'main')
  manageView?.classList.toggle('hidden', viewMode !== 'manage')
  if (headerTitle) {
    headerTitle.textContent = viewMode === 'manage' ? 'Settings' : 'Home'
  }
  if (settingsIcon && backIcon) {
    settingsIcon.classList.toggle('hidden', viewMode === 'manage')
    backIcon.classList.toggle('hidden', viewMode === 'main')
  }
  if (toggleViewBtn) {
    if (viewMode === 'manage') {
      toggleViewBtn.title = 'Go to Home'
      toggleViewBtn.setAttribute('aria-label', 'Go to Home')
    } else {
      toggleViewBtn.title = 'Manage saved prompts'
      toggleViewBtn.setAttribute('aria-label', 'Manage saved prompts')
    }
  }
  if (viewMode === 'manage') {
    renderManagePromptList()
  }
}

searchInput?.addEventListener('input', event => {
  filter = event.target.value.trim().toLowerCase()
  refreshTree()
})

respectToggle?.addEventListener('change', event => {
  applyRespectGitignoreState(Boolean(event.target.checked))
  selected = new Set()
  expanded = new Set()
  vscode.postMessage({ type: 'toggleRespectGitignore', value: event.target.checked })
})

copyButton?.addEventListener('click', () => {
  vscode.postMessage({
    type: 'requestCopy',
    prompt: promptValue,
    includePrompt,
    includeSavedPrompts,
    includeFiles,
    metaPromptIds: [...selectedMetaPromptIds],
  })
})

selectAllCheckbox?.addEventListener('change', event => {
  toggleSelectAll(event.target.checked)
})

refreshButton?.addEventListener('click', () => {
  setRefreshLoading(true)
  vscode.postMessage({ type: 'requestRefresh' })
})

promptInput?.addEventListener('input', event => {
  promptValue = event.target.value ?? ''
  vscode.postMessage({ type: 'promptChanged', value: promptValue })
})

includePromptCheckbox?.addEventListener('change', event => {
  includePrompt = Boolean(event.target.checked)
  vscode.postMessage({ type: 'includePromptChanged', value: includePrompt })
})

includeSavedPromptsCheckbox?.addEventListener('change', event => {
  includeSavedPrompts = Boolean(event.target.checked)
  vscode.postMessage({ type: 'includeSavedPromptsChanged', value: includeSavedPrompts })
})

includeFilesCheckbox?.addEventListener('change', event => {
  includeFiles = Boolean(event.target.checked)
  vscode.postMessage({ type: 'includeFilesChanged', value: includeFiles })
})

toggleViewBtn?.addEventListener('click', () => {
  if (viewMode === 'main') {
    resetMetaPromptForm()
    applyViewMode('manage')
    vscode.postMessage({ type: 'setViewMode', mode: 'manage' })
  } else {
    resetMetaPromptForm()
    setManageStatus('')
    applyViewMode('main')
    vscode.postMessage({ type: 'setViewMode', mode: 'main' })
  }
})

metaPromptCancel?.addEventListener('click', () => {
  resetMetaPromptForm()
})

manageForm?.addEventListener('submit', event => {
  event.preventDefault()
  const name = manageNameInput?.value.trim() ?? ''
  const body = manageBodyInput?.value.trim() ?? ''
  if (!name || !body) {
    setManageStatus('Provide a name and prompt content.', 'warning')
    return
  }
  const duplicate = metaPrompts.some(
    prompt => prompt.name.toLowerCase() === name.toLowerCase() && prompt.id !== editingMetaPromptId
  )
  if (duplicate) {
    setManageStatus('A prompt with this name already exists.', 'warning')
    return
  }
  if (editingMetaPromptId) {
    vscode.postMessage({ type: 'updateMetaPrompt', id: editingMetaPromptId, name, body })
    setManageStatus('Updating prompt...', 'info')
  } else {
    vscode.postMessage({ type: 'createMetaPrompt', name, body })
    setManageStatus('Saving prompt...', 'info')
  }
  resetMetaPromptForm(false)
})

window.addEventListener('message', event => {
  const message = event.data
  switch (message?.type) {
    case 'loading':
      if (treeRoot) {
        treeRoot.innerHTML = '<div class="message">Loading files...</div>'
      }
      if (selectAllCheckbox) {
        selectAllCheckbox.disabled = true
        selectAllCheckbox.checked = false
        selectAllCheckbox.indeterminate = false
      }
      setStatus('')
      setRefreshLoading(true)
      break
    case 'treeData': {
      treeData = message.nodes ?? []
      expanded = new Set(Array.isArray(message.expanded) ? message.expanded : [])
      pruneExpanded(treeData)
      const map = flatten(treeData)
      selected = new Set(
        Array.isArray(message.selection) ? message.selection.filter(path => map.has(path)) : []
      )
      if (respectToggle) {
        respectToggle.checked = !!message.respectGitignore
      }
      applyRespectGitignoreState(!!message.respectGitignore)
      setPromptFromState(message.prompt)
      setIncludeFromState(message.includePrompt)
      setIncludeSavedPromptsFromState(message.includeSavedPrompts)
      setIncludeFilesFromState(message.includeFiles)
      filter = searchInput?.value?.trim().toLowerCase() ?? ''
      setStatus('')
      refreshTree()
      setRefreshLoading(false)
      break
    }
    case 'childrenLoaded': {
      const path = message.path
      const children = Array.isArray(message.children) ? message.children : []
      const target = findNodeByPath(treeData, path)
      if (target) {
        target.children = children
        target.hasChildren = children.length > 0
        loadingChildren.delete(path)
        if (pendingSelect.has(path)) {
          const desired = pendingSelect.get(path)
          pendingSelect.delete(path)
          const files = collectFiles(target)
          files.forEach(file => {
            if (desired) {
              selected.add(file.path)
            } else {
              selected.delete(file.path)
            }
          })
          vscode.postMessage({ type: 'selectionChanged', paths: [...selected] })
          ensureFolderSelection(target, desired)
        }
        refreshTree()
      }
      break
    }
    case 'uiState':
      if (respectToggle && message.respectGitignore !== undefined) {
        respectToggle.checked = !!message.respectGitignore
      }
      if (message.respectGitignore !== undefined) {
        applyRespectGitignoreState(!!message.respectGitignore)
      }
      setPromptFromState(message.prompt)
      setIncludeFromState(message.includePrompt)
      setIncludeSavedPromptsFromState(message.includeSavedPrompts)
      setIncludeFilesFromState(message.includeFiles)
      expanded = new Set(Array.isArray(message.expanded) ? message.expanded : [])
      setMetaPromptsFromState(message.metaPrompts)
      setSelectedMetaPromptIdsFromState(message.selectedMetaPromptIds)
      applyViewMode(message.viewMode === 'manage' ? 'manage' : 'main')
      setRefreshLoading(false)
      break
    case 'selectionSummary': {
      const summary = message.summary
      if (!selectionInfo) {
        break
      }
      if (!summary || !summary.count) {
        selectionInfo.textContent = 'No files selected'
      } else {
        const plural = summary.count === 1 ? '' : 's'
        const tokens = typeof summary.tokenCount === 'number' ? summary.tokenCount : 0
        const formatted = tokens.toLocaleString()
        const tokenLabel = tokens === 1 ? 'token' : 'tokens'
        selectionInfo.textContent =
          summary.count + ' file' + plural + ' selected (' + formatted + ' ' + tokenLabel + ')'
      }
      break
    }
    case 'warning':
      setStatus(message.text ?? '', 'warning')
      setRefreshLoading(false)
      break
    case 'status':
      setStatus(message.text ?? '', message.level === 'warning' ? 'warning' : 'info')
      setRefreshLoading(false)
      break
    case 'noWorkspace':
      if (selectionInfo) {
        selectionInfo.textContent = 'Open a workspace to use Context Kit'
      }
      if (treeRoot) {
        treeRoot.innerHTML = '<div class="message">Workspace unavailable.</div>'
      }
      setStatus('')
      setRefreshLoading(false)
      break
  }
})

setStatus('')
renderMetaPromptList()
renderManagePromptList()
applyViewMode(viewMode)
setManageStatus('')
updateSelectAllCheckbox()
setRefreshLoading(false)
vscode.postMessage({ type: 'ready' })
