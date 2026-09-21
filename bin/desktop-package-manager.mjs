import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_NODE_VERSION = '22.22.3'
// Official https://nodejs.org/dist/v22.22.3/SHASUMS256.txt
const hashes = { x64: '780f44f2c53c108bae261ada21a525b4bfe733c020ac85e41bfe94479090ac9b', arm64: '65044d409333b941086486545992141d1145198d7f0e0fc0c3bf62080fd8ee51' }
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export async function prepareDesktopPackageManager(options = {}) {
  const platform = options.platform || process.platform
  const host = options.host || process.env.DSH_TAVERN_HOST || process.env.DSH_TAVERN_RUNTIME_HOST
  if (platform !== 'win32' || host !== 'desktop') return null
  const env = options.env || process.env
  const arch = options.arch || process.arch
  if (!hashes[arch]) throw new Error(`不支持的 Windows 包管理架构：${arch}`)
  const home = options.home || env.DSH_HOME
  if (!home || !path.isAbsolute(home)) throw new Error('Desktop 包管理需要明确的 DSH_HOME')
  const executable = env.DSH_DESKTOP_APP_EXECUTABLE || process.execPath
  const candidates = [
    path.join(path.dirname(executable), 'resources/app.asar.unpacked/node_modules/pnpm/bin/pnpm.mjs'),
    ...(env.DSH_DESKTOP_DSH_BOOTSTRAP ? [path.resolve(path.dirname(env.DSH_DESKTOP_DSH_BOOTSTRAP), '../node_modules/pnpm/bin/pnpm.mjs')] : []),
  ]
  const entry = options.entry || candidates.find(existsSync)
  if (!entry || !existsSync(entry)) throw new Error('找不到当前 Desktop 自带的 pnpm，请从该 Desktop 的 DSH Terminal 运行安装。')
  const root = path.join(home, 'tools', 'desktop-package-manager')
  const bin = path.join(root, 'bin')
  const nodeDir = path.join(root, `node-v${PACKAGE_NODE_VERSION}-${arch}`)
  const node = path.join(nodeDir, 'node.exe')
  await mkdir(bin, { recursive: true }); await mkdir(nodeDir, { recursive: true })
  let valid = false
  try { valid = digest(await readFile(node)) === hashes[arch] } catch {}
  if (!valid) {
    options.onProgress?.('正在准备 Windows 更新运行环境…')
    const url = `https://nodejs.org/dist/v${PACKAGE_NODE_VERSION}/win-${arch}/node.exe`
    const response = await (options.fetch || fetch)(url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`无法下载 Windows 更新运行环境：HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (digest(bytes) !== hashes[arch]) throw new Error('Windows 更新运行环境 SHA-256 校验失败，已停止安装')
    const temporary = node + '.' + randomUUID() + '.tmp'
    try { await writeFile(temporary, bytes); await rename(temporary, node) }
    finally { await rm(temporary, { force: true }) }
  }
  const runner = `const path=require('node:path');\nconst entry=${JSON.stringify(entry)};\nfor(const key of Object.keys(process.env))if(key.toUpperCase()==='ELECTRON_RUN_AS_NODE')delete process.env[key];\nprocess.env.NODE=process.execPath;\nconst key=Object.keys(process.env).find(k=>k.toLowerCase()==='path')||'PATH';\nprocess.env[key]=path.dirname(process.execPath)+';'+(process.env[key]||'');\nprocess.env.npm_config_runtime='electron';\n${process.versions.electron ? `process.env.npm_config_target=${JSON.stringify(process.versions.electron)};\n` : ''}process.env.npm_config_disturl='https://electronjs.org/headers';\nprocess.argv=[process.execPath,entry,'--config.minimumReleaseAge=0',...process.argv.slice(2)];\nimport(require('node:url').pathToFileURL(entry).href).catch(e=>{console.error(e);process.exitCode=1});\n`
  await writeFile(path.join(bin, 'pnpm-runner.cjs'), runner)
  await writeFile(path.join(bin, 'pnpm.cmd'), `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE="\r\n"%~dp0..\\node-v${PACKAGE_NODE_VERSION}-${arch}\\node.exe" "%~dp0pnpm-runner.cjs" %*\r\nexit /b %errorlevel%\r\n`)
  return { bin, node, runner: path.join(bin, 'pnpm-runner.cjs') }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareDesktopPackageManager()
    if (result) console.log(result.bin)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
