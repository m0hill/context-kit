const esbuild = require('esbuild')
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

const production = process.argv.includes('--production')
const watchMode = process.argv.includes('--watch')

function createProblemMatcherPlugin(label) {
  return {
    name: `esbuild-problem-matcher-${label}`,
    setup(build) {
      build.onStart(() => {
        console.log(`[watch] ${label} build started`)
      })
      build.onEnd(result => {
        result.errors.forEach(({ text, location }) => {
          console.error(`✘ [ERROR] ${text}`)
          if (location) {
            console.error(`    ${location.file}:${location.line}:${location.column}:`)
          }
        })
        console.log(`[watch] ${label} build finished`)
      })
    },
  }
}

const WEBVIEW_HTML_SOURCE = path.resolve(__dirname, 'src/webview/ui/index.html')
const WEBVIEW_OUT_DIR = path.resolve(__dirname, 'dist/webview')
const WEBVIEW_HTML_OUTPUT = path.join(WEBVIEW_OUT_DIR, 'index.html')

async function copyWebviewHtml() {
  await fsp.mkdir(WEBVIEW_OUT_DIR, { recursive: true })
  await fsp.copyFile(WEBVIEW_HTML_SOURCE, WEBVIEW_HTML_OUTPUT)
}

function startHtmlWatcher() {
  try {
    const watcher = fs.watch(WEBVIEW_HTML_SOURCE, async eventType => {
      if (eventType === 'change' || eventType === 'rename') {
        try {
          await copyWebviewHtml()
          console.log('[watch] webview template copied')
        } catch (error) {
          console.error('[watch] failed to copy webview template', error)
        }
      }
    })
    return watcher
  } catch (error) {
    console.error('[watch] unable to watch webview template', error)
    return undefined
  }
}

function getExtensionBuild() {
  return esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [createProblemMatcherPlugin('extension')],
  })
}

function getWebviewBuild() {
  return esbuild.context({
    entryPoints: ['src/webview/ui/main.ts'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    platform: 'browser',
    target: ['es2022'],
    outdir: 'dist/webview',
    logLevel: 'silent',
    entryNames: '[name]',
    assetNames: '[name]',
    loader: {
      '.css': 'css',
    },
    plugins: [createProblemMatcherPlugin('webview')],
  })
}

async function main() {
  const [extensionCtx, webviewCtx] = await Promise.all([getExtensionBuild(), getWebviewBuild()])
  await copyWebviewHtml()

  if (watchMode) {
    const htmlWatcher = startHtmlWatcher()
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()])
    if (htmlWatcher) {
      const cleanup = () => {
        htmlWatcher.close()
      }
      process.on('SIGINT', cleanup)
      process.on('SIGTERM', cleanup)
    }
  } else {
    await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()])
    await copyWebviewHtml()
    await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()])
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
