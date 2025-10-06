import { existsSync, readFileSync } from 'fs'
import * as vscode from 'vscode'

import { getNonce } from '../utils'

const WEBVIEW_DIST_PATH = ['dist', 'webview'] as const
const TEMPLATE_NAME = 'index.html'
const SCRIPT_NAME = 'main.js'
const STYLE_NAME = 'main.css'

function getAssetUri(context: vscode.ExtensionContext, fileName: string) {
  return vscode.Uri.joinPath(context.extensionUri, ...WEBVIEW_DIST_PATH, fileName)
}

function replaceAll(source: string, search: string, value: string) {
  return source.split(search).join(value)
}

function renderMissingHtml(message: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>Context Kit</title>
	<style>
		body { font-family: var(--vscode-font-family, sans-serif); padding: 1.5rem; }
		h1 { font-size: 1.4rem; margin-bottom: 0.75rem; }
		p { margin: 0; }
	</style>
</head>
<body>
	<h1>Context Kit</h1>
	<p>${message}</p>
</body>
</html>`
}

export function getWebviewHtml(context: vscode.ExtensionContext, webview: vscode.Webview) {
  const templateUri = getAssetUri(context, TEMPLATE_NAME)
  if (!existsSync(templateUri.fsPath)) {
    return renderMissingHtml('Webview assets are missing. Run "pnpm run compile" to build them.')
  }

  const scriptUri = getAssetUri(context, SCRIPT_NAME)
  const styleUri = getAssetUri(context, STYLE_NAME)
  if (!existsSync(scriptUri.fsPath) || !existsSync(styleUri.fsPath)) {
    return renderMissingHtml('Webview bundle is incomplete. Run "pnpm run compile" to rebuild it.')
  }

  const template = readFileSync(templateUri.fsPath, 'utf8')
  const nonce = getNonce()
  let html = template
  html = replaceAll(html, '{{cspSource}}', webview.cspSource)
  html = replaceAll(html, '{{nonce}}', nonce)
  html = replaceAll(html, '{{scriptUri}}', webview.asWebviewUri(scriptUri).toString())
  html = replaceAll(html, '{{styleUri}}', webview.asWebviewUri(styleUri).toString())
  return html
}
