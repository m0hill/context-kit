import * as vscode from 'vscode'

import { MetaPrompt } from './types'

const STORAGE_KEY = 'contextKit.metaPrompts'

function sanitize(prompts: unknown): MetaPrompt[] {
  if (!Array.isArray(prompts)) {
    return []
  }
  return prompts
    .map(item => {
      if (!item || typeof item !== 'object') {
        return null
      }
      const id = typeof item.id === 'string' ? item.id : undefined
      const name = typeof item.name === 'string' ? item.name : undefined
      const body = typeof item.body === 'string' ? item.body : undefined
      if (!id || !name || !body) {
        return null
      }
      return { id, name, body } satisfies MetaPrompt
    })
    .filter((value): value is MetaPrompt => Boolean(value))
}

export function loadMetaPrompts(context: vscode.ExtensionContext) {
  const stored = context.globalState.get<MetaPrompt[]>(STORAGE_KEY, [])
  return sanitize(stored)
}

async function saveMetaPrompts(context: vscode.ExtensionContext, prompts: MetaPrompt[]) {
  await context.globalState.update(STORAGE_KEY, prompts)
}

function generateId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

export async function addMetaPrompt(context: vscode.ExtensionContext, name: string, body: string) {
  const prompts = loadMetaPrompts(context)
  const prompt: MetaPrompt = {
    id: generateId(),
    name: name.trim(),
    body: body.trim(),
  }
  const updated = [...prompts, prompt]
  await saveMetaPrompts(context, updated)
  return updated
}

export async function updateMetaPrompt(
  context: vscode.ExtensionContext,
  id: string,
  name: string,
  body: string
) {
  const prompts = loadMetaPrompts(context)
  const updated = prompts.map(prompt =>
    prompt.id === id ? { ...prompt, name: name.trim(), body: body.trim() } : prompt
  )
  await saveMetaPrompts(context, updated)
  return updated
}

export async function deleteMetaPrompt(context: vscode.ExtensionContext, id: string) {
  const prompts = loadMetaPrompts(context).filter(prompt => prompt.id !== id)
  await saveMetaPrompts(context, prompts)
  return prompts
}
