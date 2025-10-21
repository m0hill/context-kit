import * as path from 'path'
import * as vscode from 'vscode'

export function inferLanguage(filePath: string) {
  // Get the base filename for special file matching
  const fileName = path.basename(filePath).toLowerCase()

  // Special filenames without extensions
  const specialFiles: Record<string, string> = {
    'dockerfile': 'dockerfile',
    'dockerfile.dev': 'dockerfile',
    'dockerfile.prod': 'dockerfile',
    'dockerfile.test': 'dockerfile',
    '.dockerfile': 'dockerfile',
    'docker-compose.yml': 'dockercompose',
    'docker-compose.yaml': 'dockercompose',
    'makefile': 'makefile',
    'makefile.am': 'makefile',
    'gnumakefile': 'makefile',
    'cmakelists.txt': 'cmake',
    'rakefile': 'ruby',
    'gemfile': 'ruby',
    'podfile': 'ruby',
    'vagrantfile': 'ruby',
    '.gitignore': 'ignore',
    '.gitattributes': 'git',
    '.gitmodules': 'git',
    '.dockerignore': 'ignore',
    '.npmignore': 'ignore',
    '.eslintignore': 'ignore',
    '.prettierignore': 'ignore',
    '.env': 'dotenv',
    '.env.local': 'dotenv',
    '.env.development': 'dotenv',
    '.env.production': 'dotenv',
    '.env.test': 'dotenv',
    '.env.example': 'dotenv',
    '.editorconfig': 'editorconfig',
    '.eslintrc': 'json',
    '.eslintrc.js': 'javascript',
    '.eslintrc.json': 'json',
    '.prettierrc': 'json',
    '.prettierrc.js': 'javascript',
    '.prettierrc.json': 'json',
    '.babelrc': 'json',
    '.babelrc.js': 'javascript',
    'package.json': 'json',
    'package-lock.json': 'json',
    'tsconfig.json': 'jsonc',
    'jsconfig.json': 'jsonc',
    'composer.json': 'json',
    'cargo.toml': 'toml',
    'go.mod': 'gomod',
    'go.sum': 'gosum',
    'requirements.txt': 'pip-requirements',
    'pipfile': 'toml',
    'poetry.lock': 'toml',
    'yarn.lock': 'yarnlock',
    'pom.xml': 'xml',
    'build.gradle': 'gradle',
    'settings.gradle': 'gradle',
    'gradlew': 'shellscript',
    'license': 'plaintext',
    'readme': 'markdown',
    'readme.md': 'markdown',
    'changelog': 'markdown',
    'changelog.md': 'markdown',
  }

  if (specialFiles[fileName]) {
    return specialFiles[fileName]
  }

  const ext = path.extname(filePath).toLowerCase().slice(1)
  if (!ext) {
    return ''
  }

  const map: Record<string, string> = {
    // JavaScript / TypeScript
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    cjs: 'javascript',
    mjs: 'javascript',

    // Styles
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',

    // Markup
    html: 'html',
    htm: 'html',
    xhtml: 'html',
    xml: 'xml',
    svg: 'xml',

    // Data formats
    json: 'json',
    jsonc: 'jsonc',
    json5: 'json5',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    properties: 'properties',

    // Documentation
    md: 'markdown',
    mdx: 'mdx',
    markdown: 'markdown',
    rst: 'restructuredtext',
    adoc: 'asciidoc',
    tex: 'latex',

    // Python
    py: 'python',
    pyw: 'python',
    pyx: 'python',
    pyi: 'python',

    // Java / JVM
    java: 'java',
    class: 'java',
    jar: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    groovy: 'groovy',
    gradle: 'gradle',
    scala: 'scala',
    sc: 'scala',

    // C / C++
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hh: 'cpp',
    hxx: 'cpp',

    // C#
    cs: 'csharp',
    csx: 'csharp',

    // Web frameworks
    vue: 'vue',
    svelte: 'svelte',
    astro: 'astro',

    // Template engines
    ejs: 'ejs',
    hbs: 'handlebars',
    handlebars: 'handlebars',
    pug: 'pug',
    jade: 'pug',

    // Other languages
    go: 'go',
    rs: 'rust',
    rust: 'rust',
    rb: 'ruby',
    erb: 'erb',
    php: 'php',
    swift: 'swift',
    dart: 'dart',
    lua: 'lua',
    r: 'r',
    perl: 'perl',
    pl: 'perl',
    pm: 'perl',

    // Shell scripts
    sh: 'shellscript',
    bash: 'shellscript',
    zsh: 'shellscript',
    fish: 'fish',
    ps1: 'powershell',
    psm1: 'powershell',
    bat: 'bat',
    cmd: 'bat',

    // Database
    sql: 'sql',
    mysql: 'sql',
    pgsql: 'sql',

    // Docker
    dockerfile: 'dockerfile',

    // Other formats
    graphql: 'graphql',
    gql: 'graphql',
    proto: 'proto',
    prisma: 'prisma',
    tf: 'terraform',
    tfvars: 'terraform',
    bicep: 'bicep',

    // Archive / Binary
    zip: 'zip',
    tar: 'tar',
    gz: 'gzip',
    rar: 'rar',
    '7z': '7z',

    // Images
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
    gif: 'image',
    webp: 'image',
    ico: 'image',
    bmp: 'image',

    // Fonts
    ttf: 'font',
    otf: 'font',
    woff: 'font',
    woff2: 'font',
    eot: 'font',

    // Audio / Video
    mp3: 'audio',
    wav: 'audio',
    ogg: 'audio',
    mp4: 'video',
    webm: 'video',
    avi: 'video',

    // Documents
    pdf: 'pdf',
    doc: 'word',
    docx: 'word',
    xls: 'excel',
    xlsx: 'excel',
    ppt: 'powerpoint',
    pptx: 'powerpoint',

    // Lock files
    lock: 'lock',
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
