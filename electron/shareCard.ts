// Shareable iteration report ("我的 AI 团队 build 了这个" share card).
//
// For each completed iteration, generate a standalone HTML page
// recapping: the user prompt, which 8 AI specialists ran, their key
// observations (especially disagreements), final cost + duration,
// and a button to open the produced artifact. The page is self-
// contained — no external deps, can be sent to a friend or pasted
// to social media as a screenshot.
//
// This is the "炫耀面" of polycoder for the 中年用户 / vibe coder
// market — the deliverable they show to others.

import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type Database from 'better-sqlite3'
import { getIteration } from '../data/iterations.js'
import { getWorkspace } from '../data/workspace.js'
import { totalsByIteration, listCostRecordsForIteration } from '../data/costRecords.js'
import { ROLE_LABEL } from '../src/components/role-palette.js'
import type { RoleType, RoleOutputEnvelope } from '../core/types/role.js'

const ROLE_ORDER: RoleType[] = [
  'translator',
  'designer',
  'architect',
  'coder',
  'adversary',
  'long_term_critic',
  'test_runner',
  'communicator',
]

export type GenerateShareCardArgs = {
  db: Database.Database
  iteration_id: string
}

export type GenerateShareCardResult =
  | { ok: true; path: string; html: string }
  | { ok: false; error: string }

export function generateShareCard(
  args: GenerateShareCardArgs,
): GenerateShareCardResult {
  const iter = getIteration(args.db, args.iteration_id)
  if (!iter) return { ok: false, error: 'iteration not found' }
  const ws = getWorkspace(args.db, iter.workspace_id)
  if (!ws) return { ok: false, error: 'workspace not found' }

  const totals = totalsByIteration(args.db, args.iteration_id) ?? {
    total_cost_usd: 0,
    call_count: 0,
  }
  const costRecords = listCostRecordsForIteration(args.db, args.iteration_id)
  const modelByRole: Record<string, string> = {}
  for (const r of costRecords) modelByRole[r.role] = r.model

  let roleOutputs: Record<string, RoleOutputEnvelope> = {}
  try {
    roleOutputs = JSON.parse(iter.role_outputs_json) as Record<
      string,
      RoleOutputEnvelope
    >
  } catch {
    roleOutputs = {}
  }

  const html = renderShareCardHtml({
    prompt: iter.user_prompt,
    iterNumber: iter.iteration_number,
    workspaceName: ws.name,
    trafficLight: iter.traffic_light,
    durationMs: iter.duration_ms ?? 0,
    totalCostUsd: totals.total_cost_usd,
    callCount: totals.call_count,
    filesChanged: iter.files_changed,
    roleOutputs,
    modelByRole,
  })

  // Write to {workspace_root}/.polycoder/share-iter-{N}.html so the
  // user can share / open it in browser.
  const outDir = resolve(ws.workspace_root, '.polycoder')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `share-iter-${iter.iteration_number}.html`)
  try {
    writeFileSync(outPath, html, 'utf8')
    return { ok: true, path: outPath, html }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

function renderShareCardHtml(opts: {
  prompt: string
  iterNumber: number
  workspaceName: string
  trafficLight: string | null
  durationMs: number
  totalCostUsd: number
  callCount: number
  filesChanged: string[]
  roleOutputs: Record<string, RoleOutputEnvelope>
  modelByRole: Record<string, string>
}): string {
  const verdictText =
    opts.trafficLight === 'green'
      ? '✓ 团队一致通过'
      : opts.trafficLight === 'yellow'
        ? '⚠ 已交付，附说明'
        : opts.trafficLight === 'red'
          ? '✕ 团队建议复跑'
          : '— 状态未定'
  const verdictColor =
    opts.trafficLight === 'green'
      ? '#22c55e'
      : opts.trafficLight === 'yellow'
        ? '#eab308'
        : opts.trafficLight === 'red'
          ? '#ef4444'
          : '#94a3b8'

  const durationText = `${Math.round(opts.durationMs / 1000)}s`
  const costText = `$${opts.totalCostUsd.toFixed(4)}`
  const modelList = Array.from(new Set(Object.values(opts.modelByRole)))

  const roleRows = ROLE_ORDER.filter((r) => opts.roleOutputs[r])
    .map((r) => {
      const env = opts.roleOutputs[r]!
      const model = opts.modelByRole[r] ?? env.model ?? 'unknown'
      return `
        <div class="role-row">
          <div class="role-name">${escapeHtml(ROLE_LABEL[r])}</div>
          <div class="role-model">${escapeHtml(model)}</div>
          <div class="role-summary">${escapeHtml(env.summary ?? '')}</div>
        </div>`
    })
    .join('')

  const filesList = opts.filesChanged
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(opts.workspaceName)} · 团队第 ${opts.iterNumber} 轮</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, system-ui, "PingFang SC", "Helvetica Neue", sans-serif;
      background: linear-gradient(135deg, #0a0e1a 0%, #1a1f3a 100%);
      color: #f8fafc;
      padding: 32px 16px;
      min-height: 100vh;
      line-height: 1.5;
    }
    .card {
      max-width: 640px;
      margin: 0 auto;
      background: rgba(255,255,255,0.04);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 28px 32px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .header .mark {
      width: 32px; height: 32px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    }
    .header h1 {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .header .sub {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 1px;
      font-family: "SF Mono", Menlo, monospace;
    }
    .verdict {
      padding: 14px 16px;
      border-radius: 12px;
      background: rgba(255,255,255,0.04);
      border: 1px solid ${verdictColor}55;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .verdict-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      background: ${verdictColor};
      box-shadow: 0 0 12px ${verdictColor}aa;
    }
    .verdict-text {
      font-size: 14px;
      font-weight: 500;
    }
    .prompt-quote {
      font-size: 18px;
      font-weight: 400;
      letter-spacing: -0.01em;
      padding: 16px 18px;
      background: rgba(99,102,241,0.08);
      border-left: 3px solid #6366f1;
      border-radius: 6px;
      margin-bottom: 24px;
      color: #e2e8f0;
      line-height: 1.4;
    }
    .meta-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 28px;
    }
    .meta-cell {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 12px 14px;
      text-align: center;
    }
    .meta-label {
      font-size: 10px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .meta-value {
      font-size: 16px;
      font-weight: 600;
      color: #f8fafc;
    }
    h2 {
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 10px;
      margin-top: 4px;
    }
    .role-row {
      display: grid;
      grid-template-columns: 110px 110px 1fr;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      align-items: baseline;
    }
    .role-row:last-child { border-bottom: none; }
    .role-name {
      font-size: 12.5px;
      font-weight: 600;
      color: #c4b5fd;
    }
    .role-model {
      font-size: 11px;
      color: #94a3b8;
      font-family: "SF Mono", Menlo, monospace;
    }
    .role-summary {
      font-size: 12.5px;
      color: #cbd5e1;
      line-height: 1.45;
    }
    .files-list {
      list-style: none;
      padding: 12px 16px;
      background: rgba(255,255,255,0.03);
      border-radius: 8px;
      margin-top: 8px;
    }
    .files-list li {
      font-size: 12px;
      color: #94a3b8;
      font-family: "SF Mono", Menlo, monospace;
      padding: 3px 0;
    }
    .footer {
      margin-top: 28px;
      padding-top: 20px;
      border-top: 1px solid rgba(255,255,255,0.08);
      text-align: center;
      font-size: 11px;
      color: #64748b;
    }
    .models-pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 24px;
    }
    .model-pill {
      font-size: 10.5px;
      padding: 3px 9px;
      background: rgba(99,102,241,0.12);
      color: #c4b5fd;
      border: 1px solid rgba(99,102,241,0.30);
      border-radius: 100px;
      font-family: "SF Mono", Menlo, monospace;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="mark">⬡</div>
      <div>
        <h1>${escapeHtml(opts.workspaceName)}</h1>
        <div class="sub">第 ${opts.iterNumber} 轮 · polycoder 多模型协作</div>
      </div>
    </div>

    <div class="prompt-quote">"${escapeHtml(opts.prompt)}"</div>

    <div class="meta-row">
      <div class="meta-cell">
        <div class="meta-label">用时</div>
        <div class="meta-value">${durationText}</div>
      </div>
      <div class="meta-cell">
        <div class="meta-label">总开销</div>
        <div class="meta-value">${costText}</div>
      </div>
      <div class="meta-cell">
        <div class="meta-label">调用次数</div>
        <div class="meta-value">${opts.callCount}</div>
      </div>
    </div>

    <div class="verdict">
      <div class="verdict-dot"></div>
      <div class="verdict-text">${verdictText}</div>
    </div>

    <h2>团队动用了这些模型</h2>
    <div class="models-pill-row">
      ${modelList.map((m) => `<span class="model-pill">${escapeHtml(m)}</span>`).join('')}
    </div>

    <h2>每个角色做了什么</h2>
    ${roleRows}

    ${
      opts.filesChanged.length > 0
        ? `<h2 style="margin-top: 24px">改了这些文件 (${opts.filesChanged.length})</h2>
    <ul class="files-list">${filesList}</ul>`
        : ''
    }

    <div class="footer">
      polycoder · 多 AI 团队协作写代码 · 这张卡片是这次迭代的可分享留念
    </div>
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
