// Iteration revert — restores pre-edit file content captured by
// runQuickEdit's appendFileSnapshots. Powers the "Revert" button
// in the result panel.
//
// Safety:
//   * Each path is re-validated against the workspace root with
//     resolveInWorkspace, so a poisoned DB row can't escape.
//   * If pre_content is NULL the file was newly created — revert
//     deletes it (the only deletion path in polycoder; intentionally
//     scoped to revert).
//   * Files no longer present in the workspace are skipped with a
//     warning (someone moved them manually, don't second-guess).

import type Database from 'better-sqlite3'
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from 'node:fs'
import { dirname, resolve, isAbsolute, relative, normalize } from 'node:path'
import { loadFileSnapshots } from '../../data/iterationFileSnapshots.js'
import { getIteration } from '../../data/iterations.js'
import { getWorkspace } from '../../data/workspace.js'

function resolveInWorkspaceForRevert(
  workspaceRoot: string,
  displayPath: string,
): string | null {
  const root = normalize(resolve(workspaceRoot))
  const candidate = isAbsolute(displayPath)
    ? normalize(displayPath)
    : normalize(resolve(root, displayPath))
  const rel = relative(root, candidate)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return candidate
}

export type RevertResult = {
  ok: boolean
  restored: string[]
  deleted: string[]
  skipped: Array<{ path: string; reason: string }>
  error?: string
}

export function revertIteration(
  db: Database.Database,
  iteration_id: string,
): RevertResult {
  const iter = getIteration(db, iteration_id)
  if (!iter) {
    return {
      ok: false,
      restored: [],
      deleted: [],
      skipped: [],
      error: 'iteration not found',
    }
  }
  const ws = getWorkspace(db, iter.workspace_id)
  if (!ws) {
    return {
      ok: false,
      restored: [],
      deleted: [],
      skipped: [],
      error: 'workspace not found',
    }
  }
  const snapshots = loadFileSnapshots(db, iteration_id)
  if (snapshots.length === 0) {
    return {
      ok: false,
      restored: [],
      deleted: [],
      skipped: [],
      error:
        'No file snapshots for this iteration — it predates the revert feature.',
    }
  }

  const restored: string[] = []
  const deleted: string[] = []
  const skipped: RevertResult['skipped'] = []

  for (const snap of snapshots) {
    const abs = resolveInWorkspaceForRevert(ws.workspace_root, snap.display_path)
    if (!abs) {
      skipped.push({
        path: snap.display_path,
        reason: 'path resolves outside workspace',
      })
      continue
    }

    if (snap.pre_content === null) {
      // File was created by this iteration → revert = delete.
      if (existsSync(abs)) {
        try {
          unlinkSync(abs)
          deleted.push(snap.display_path)
        } catch (e) {
          skipped.push({
            path: snap.display_path,
            reason: `delete failed: ${e instanceof Error ? e.message : String(e)}`,
          })
        }
      } else {
        skipped.push({
          path: snap.display_path,
          reason: 'file already gone',
        })
      }
      continue
    }

    // Restore prior content. Make sure parent dir exists in case the
    // user (or some other tool) cleaned up around it.
    try {
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, snap.pre_content, 'utf8')
      restored.push(snap.display_path)
    } catch (e) {
      skipped.push({
        path: snap.display_path,
        reason: `write failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  return {
    ok: true,
    restored,
    deleted,
    skipped,
  }
}
