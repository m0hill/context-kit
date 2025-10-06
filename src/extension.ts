import * as vscode from 'vscode'

import { copySelection } from './copy'
import { ContextKitState } from './state'
import { registerContextKitView } from './viewProvider'

export function activate(context: vscode.ExtensionContext) {
  const state = new ContextKitState()
  const provider = registerContextKitView(context, state)
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const scheduleRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
    }
    refreshTimer = setTimeout(() => void provider.refreshTree(), 250)
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('context-kit.openPanel', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.contextKit')
    }),
    vscode.commands.registerCommand('context-kit.copyContext', async () => {
      await copySelection(state, provider.getWebview())
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => scheduleRefresh()),
    vscode.workspace.onDidCreateFiles(() => scheduleRefresh()),
    vscode.workspace.onDidDeleteFiles(() => scheduleRefresh()),
    vscode.workspace.onDidRenameFiles(() => scheduleRefresh())
  )
}

export function deactivate() {}
