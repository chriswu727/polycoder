// Smoke Pass Rate (SPR).
//
// For each iter snapshot's served_dir (computed by BPR):
//   1. Boot a tiny static HTTP server on a free port.
//   2. Launch Playwright headless Chromium, navigate to /.
//   3. Wait for domcontentloaded + a 2s settle.
//   4. Collect any error-level console messages.
//   5. Capture { text_fragments, interactive_count } as the iter's
//      golden.
//   6. For iter ≥ 2, compare against iter (N-1)'s golden:
//      - all text_fragments still resolve as visible text on the
//        current page
//      - interactive_count >= 80% of prior iter's count
//
// status = pass iff (no console errors) AND (persistence holds).
//
// SPR requires Playwright Chromium installed:
//   pnpm exec playwright install chromium
//
// Spec: docs/specs/iteration-survival-test.md §6.2.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { chromium, type Browser, type ConsoleMessage } from '@playwright/test'

import type { SPR } from './types.js'

const SETTLE_MS = 2000
const SERVER_TIMEOUT_MS = 10_000
const PAGE_TIMEOUT_MS = 15_000
const MIN_PORT = 5174
const MAX_PORT = 5184
const COUNT_THRESHOLD = 0.8

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export type SPRGolden = {
  text_fragments: string[]
  interactive_count: number
}

export type SPRArgs = {
  /** Served directory (e.g. work_dir/dist or work_dir itself). */
  served_dir: string | null
  /** Optional prior-iter golden; null for iter 1. */
  prior_golden: SPRGolden | null
}

export type SPRComputeResult = {
  spr: SPR
  /** Captured at iter N, to be saved by the caller for iter N+1. */
  golden: SPRGolden | null
}

export async function computeSPR(args: SPRArgs): Promise<SPRComputeResult> {
  const start = Date.now()

  if (!args.served_dir || !existsSync(args.served_dir)) {
    return {
      spr: {
        status: 'na',
        applicable: false,
        applicable_reason: 'no served_dir (BPR fail upstream)',
        console_errors: [],
        golden_captured: null,
        persistence_check: null,
        duration_ms: Date.now() - start,
      },
      golden: null,
    }
  }

  let server: Server | null = null
  let browser: Browser | null = null
  try {
    const { server: s, port } = await bootServer(args.served_dir)
    server = s

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const consoleErrors: string[] = []
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text().slice(0, 500))
      }
    })
    page.on('pageerror', (err: Error) => {
      consoleErrors.push(`pageerror: ${err.message.slice(0, 500)}`)
    })

    await page.goto(`http://127.0.0.1:${port}/`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT_MS,
    })
    await page.waitForTimeout(SETTLE_MS)

    const golden = await capture(page)

    let persistence_check: SPR['persistence_check'] = null
    let pass = consoleErrors.length === 0
    if (args.prior_golden) {
      const lowered = (golden.text_fragments.join('\n') + '\n').toLowerCase()
      const missing: string[] = []
      for (const frag of args.prior_golden.text_fragments) {
        if (!lowered.includes(frag.toLowerCase())) missing.push(frag)
      }
      const belowCount =
        args.prior_golden.interactive_count > 0 &&
        golden.interactive_count <
          Math.floor(args.prior_golden.interactive_count * COUNT_THRESHOLD)

      // We can't know the prior iter number from the golden alone, so
      // the runner injects it via prior_golden; but we don't have it
      // in the type. Set it to 0 to mean "unknown to SPR — caller
      // should overwrite with iter-1 once known".
      persistence_check = {
        checked_against_iter: 0,
        missing_text_fragments: missing,
        interactive_count_now: golden.interactive_count,
        interactive_count_prior: args.prior_golden.interactive_count,
        below_count_threshold: belowCount,
      }
      if (missing.length > 0 || belowCount) pass = false
    }

    return {
      spr: {
        status: pass ? 'pass' : 'fail',
        applicable: true,
        applicable_reason: args.prior_golden
          ? 'page loaded; persistence checked against prior iter'
          : 'page loaded; iter 1 (no persistence check)',
        console_errors: consoleErrors,
        golden_captured: golden,
        persistence_check,
        duration_ms: Date.now() - start,
      },
      golden,
    }
  } catch (e) {
    return {
      spr: {
        status: 'error',
        applicable: true,
        applicable_reason: `SPR threw: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`,
        console_errors: [],
        golden_captured: null,
        persistence_check: null,
        duration_ms: Date.now() - start,
      },
      golden: null,
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    if (server) {
      await new Promise<void>((res) =>
        server!.close(() => {
          res()
        }),
      )
    }
  }
}

// ─── Page capture helper ────────────────────────────────────────────

// Pass the function body as a STRING, not a function literal. tsx
// (via esbuild) injects `__name` annotations into nested function
// declarations during compile, but Playwright's serialization
// transport doesn't carry esbuild's helpers, so the browser-side
// eval throws ReferenceError: __name is not defined. Stringifying
// bypasses tsx entirely — Playwright sends raw source.
const CAPTURE_SCRIPT = `(() => {
  var isVisible = function (el) {
    var e = el;
    var r = e.getBoundingClientRect();
    var cs = window.getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (Number(cs.opacity) < 0.05) return false;
    if (r.width === 0 || r.height === 0) return false;
    return true;
  };
  var interactiveSel = 'input, button, select, textarea, a[href], [role="button"], [contenteditable="true"]';
  var interactive = Array.prototype.filter.call(
    document.querySelectorAll(interactiveSel),
    isVisible,
  ).length;
  var fragments = new Set();
  var candSel = 'h1, h2, h3, h4, h5, h6, button, label, a[href], [role="button"], legend, summary';
  Array.prototype.forEach.call(document.querySelectorAll(candSel), function (el) {
    if (!isVisible(el)) return;
    var t = (el.innerText || '').trim();
    if (t.length >= 3 && t.length <= 80) fragments.add(t);
  });
  Array.prototype.forEach.call(
    document.querySelectorAll('input[placeholder], textarea[placeholder]'),
    function (el) {
      var p = (el.placeholder || '').trim();
      if (p.length >= 3 && p.length <= 80) fragments.add(p);
    },
  );
  return {
    text_fragments: Array.from(fragments).slice(0, 30),
    interactive_count: interactive,
  };
})()`

async function capture(page: import('@playwright/test').Page): Promise<SPRGolden> {
  return (await page.evaluate(CAPTURE_SCRIPT)) as SPRGolden
}

// ─── HTTP server helper ─────────────────────────────────────────────

async function bootServer(
  rootDir: string,
): Promise<{ server: Server; port: number }> {
  const root = resolve(rootDir)
  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void => {
    let urlPath = (req.url ?? '/').split('?')[0] ?? '/'
    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html'
    // Block path traversal.
    const safe = urlPath.replace(/\.\.+/g, '')
    const filePath = join(root, safe)
    if (!filePath.startsWith(root)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      // SPA fallback: serve index.html for anything not found.
      const fallback = join(root, 'index.html')
      if (existsSync(fallback)) {
        const buf = readFileSync(fallback)
        res.writeHead(200, { 'content-type': MIME['.html']! })
        res.end(buf)
        return
      }
      res.writeHead(404)
      res.end('not found')
      return
    }
    const buf = readFileSync(filePath)
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    })
    res.end(buf)
  }

  let lastErr: unknown = null
  for (let port = MIN_PORT; port <= MAX_PORT; port++) {
    try {
      const server = await listen(handler, port)
      return { server, port }
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(
    `bootServer: no free port in [${MIN_PORT}..${MAX_PORT}] — last error: ${String(lastErr)}`,
  )
}

function listen(
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void,
  port: number,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler)
    const onError = (e: Error): void => {
      server.removeListener('error', onError)
      reject(e)
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError)
      // Accept default keep-alive but keep close() snappy.
      server.unref()
      // Re-ref so the test process awaits cleanup; flip back when
      // we're done.
      server.ref()
      resolve(server)
    })
    setTimeout(() => {
      server.removeListener('error', onError)
      reject(new Error(`server listen timeout on port ${port}`))
    }, SERVER_TIMEOUT_MS)
  })
}
