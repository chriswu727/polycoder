// iteration_file_snapshots — captures pre + post file content for
// every file an iteration touched. Used by the revert affordance:
// "I don't like this Quick Edit, undo it" writes the pre-content
// back to disk.

import type Database from 'better-sqlite3'

const MAX_SNAPSHOT_BYTES = 1 * 1024 * 1024 // 1 MB per file

export type FileSnapshot = {
  display_path: string
  pre_content: string | null
  post_content: string | null
}

export function appendFileSnapshots(
  db: Database.Database,
  iteration_id: string,
  snapshots: FileSnapshot[],
): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO iteration_file_snapshots
      (iteration_id, display_path, pre_content, post_content)
     VALUES (?, ?, ?, ?)`,
  )
  const tx = db.transaction((rows: FileSnapshot[]) => {
    for (const r of rows) {
      const pre =
        r.pre_content !== null && r.pre_content.length > MAX_SNAPSHOT_BYTES
          ? null
          : r.pre_content
      const post =
        r.post_content !== null && r.post_content.length > MAX_SNAPSHOT_BYTES
          ? null
          : r.post_content
      insert.run(iteration_id, r.display_path, pre, post)
    }
  })
  tx(snapshots)
}

export function loadFileSnapshots(
  db: Database.Database,
  iteration_id: string,
): FileSnapshot[] {
  const rows = db
    .prepare(
      `SELECT display_path, pre_content, post_content
       FROM iteration_file_snapshots
       WHERE iteration_id = ?
       ORDER BY display_path ASC`,
    )
    .all(iteration_id) as Array<{
      display_path: string
      pre_content: string | null
      post_content: string | null
    }>
  return rows.map((r) => ({
    display_path: r.display_path,
    pre_content: r.pre_content,
    post_content: r.post_content,
  }))
}
