#!/usr/bin/env node
// pnpm dev — auto-detect native binary ABI and switch before launching.
//
// Background: better-sqlite3 + keytar ship as native node modules.
// They get rebuilt against either Node's ABI or Electron's ABI.
// Tests run on Node (need Node ABI); the Electron app needs
// Electron ABI. Manually flipping with `pnpm rebuild` / `electron-
// rebuild` between every dev session is fragile.
//
// This wrapper detects the current binary ABI by reading the
// modules' build metadata + Electron's expected ABI, runs the
// right rebuild only if needed, then hands off to electron:dev.

const { execSync, spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')

function log(msg) {
  process.stdout.write(`[dev] ${msg}\n`)
}

function currentBetterSqliteAbi() {
  // better-sqlite3 stores its build target in a sidecar file
  // node_modules/.../better-sqlite3/build/Release/better_sqlite3.node
  // is a binary; the ABI is determined by which version was last
  // built. Cheapest way: try loading it from a Node process — if
  // it loads we're Node-ABI; if it throws NODE_MODULE_VERSION we're
  // Electron-ABI.
  const result = spawnSync(
    process.execPath,
    ['-e', "try { require('better-sqlite3'); console.log('node') } catch (e) { console.log(/NODE_MODULE_VERSION/.test(String(e)) ? 'electron' : 'unknown') }"],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return (result.stdout || '').trim()
}

function needsRebuild(target) {
  const current = currentBetterSqliteAbi()
  log(`current better-sqlite3 ABI: ${current}, want: ${target}`)
  return current !== target
}

function rebuildForElectron() {
  log('rebuilding native modules for Electron ABI…')
  execSync('pnpm exec electron-rebuild -f -w better-sqlite3 -w keytar', {
    cwd: ROOT,
    stdio: 'inherit',
  })
}

function killStaleProcesses() {
  // Free port 5173 and kill leftover Electron / vite from prior runs.
  try {
    execSync('pkill -9 -f "node_modules/.pnpm/electron@.*MacOS/Electron " 2>/dev/null', {
      cwd: ROOT,
      stdio: 'ignore',
    })
  } catch {
    // ignore
  }
  try {
    execSync('lsof -ti :5173 | xargs -r kill -9 2>/dev/null', {
      cwd: ROOT,
      stdio: 'ignore',
    })
  } catch {
    // ignore
  }
}

function main() {
  if (!existsSync(join(ROOT, 'package.json'))) {
    console.error('[dev] not at repo root')
    process.exit(1)
  }
  killStaleProcesses()
  if (needsRebuild('electron')) {
    rebuildForElectron()
  } else {
    log('native modules already on Electron ABI; skipping rebuild')
  }
  log('launching electron:dev …')
  const ret = spawnSync('pnpm', ['electron:dev'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  process.exit(ret.status ?? 0)
}

main()
