// Daily backup of the Eliv8 OS + Unstuck Map database (Supabase ufhduewbamnmoiksqgfq).
//
// 3 Oct 2026 audit: kinwove had a nightly local backup (its own repo,
// com.kinwove.backup); this project — which holds every Unstuck Map plan and
// every Eliv8 business — relied on Supabase's own daily backups alone, which
// cannot restore to a chosen moment.
//
// ⭐ Uses `supabase db query --linked` (the CLI's management-API login that is
// already on this machine), so no database password or service key is stored
// anywhere new. Every public table is discovered, not listed, so a table added
// next month is backed up without anyone remembering to add it.
//
// Output: ~/eliv8-backups/<YYYY-MM-DD>/<table>.json, newest 30 days kept.
// ⚠️ These files hold personal data. They stay on this Mac; never commit them.
//
// Run by ~/Library/LaunchAgents/com.eliv8.backup.plist each morning.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SUPABASE = fs.existsSync('/opt/homebrew/bin/supabase') ? '/opt/homebrew/bin/supabase' : 'supabase'
const ROOT = path.join(os.homedir(), 'eliv8-backups')
const KEEP_DAYS = 30
// ⭐ A run that fails tries once more an hour later (Daniel, 29 Oct 2026), as
// a fresh copy of this script; only the second failure is final.
const RETRY_MIN = 60
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

function query(sql) {
  const out = execFileSync(SUPABASE, ['db', 'query', '--linked', sql, '-o', 'json'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, stdio: ['ignore', 'pipe', 'pipe'],
  })
  // ⚠️ TWO OUTPUT SHAPES. Interactively the CLI wraps results as
  // { boundary, rows, warning }; under launchd it prints a bare JSON array, with
  // notices ("Initialising login role…", "A new version…") above and below. The
  // first scheduled run died on exactly this. Take the JSON block itself.
  const lines = out.split('\n')
  const first = lines.findIndex(l => /^\s*[[{]/.test(l))
  if (first < 0) throw new Error(`no JSON in CLI output: ${out.slice(0, 200)}`)
  for (let last = lines.length; last > first; last--) {
    try {
      const parsed = JSON.parse(lines.slice(first, last).join('\n'))
      return Array.isArray(parsed) ? parsed : (parsed.rows ?? parsed)
    } catch { /* trailing notice — try a shorter block */ }
  }
  throw new Error(`unreadable CLI output: ${out.slice(0, 200)}`)
}

const dir = path.join(ROOT, new Date().toISOString().slice(0, 10))
fs.mkdirSync(dir, { recursive: true })
console.log(`===== ${stamp()}  eliv8/unstuck data → ${dir} =====`)

let failed = 0
let tables = []
try {
  tables = queryWithRetry(`select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`).map(r => r.table_name)
} catch (e) {
  // No list means no backup at all; count it so the hour-later retry runs.
  failed++
  console.error(`!! table list FAILED: ${String(e?.stderr ?? e?.message ?? e).slice(0, 200)}`)
}

// ⚠️ The CLI occasionally fails a single query while it re-initialises its
// login role (4 Oct: `checkins` FAILED with only "Initialising login role…").
// Transient, so each table gets three tries before it counts as failed.
function queryWithRetry(q) {
  for (let i = 1; ; i++) {
    try { return query(q) } catch (e) { if (i >= 3) throw e; execFileSync('sleep', ['3']) }
  }
}

for (const t of tables) {
  try {
    const rows = queryWithRetry(`select coalesce(json_agg(x), '[]'::json) as data from public."${t.replace(/"/g, '')}" x`)
    const data = rows?.[0]?.data ?? []
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(data))
    console.log(`  ${t}: ${Array.isArray(data) ? data.length : '?'} rows`)
  } catch (e) {
    failed++
    console.error(`!! ${t} FAILED: ${String(e?.stderr ?? e?.message ?? e).slice(0, 200)}`)
  }
}

// Keep the newest KEEP_DAYS folders, cleaning up only after a run that
// worked, so days of failed (empty) folders can never push out the good ones.
const folders = failed ? [] : fs.readdirSync(ROOT).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort()
for (const old of folders.slice(0, Math.max(0, folders.length - KEEP_DAYS))) {
  fs.rmSync(path.join(ROOT, old), { recursive: true, force: true })
  console.log(`  pruned ${old}`)
}

console.log(`===== ${stamp()}  done: ${tables.length ? `${tables.length - failed}/${tables.length} tables` : 'no table list'} (exit ${failed ? 1 : 0}) =====`)
process.exitCode = failed ? 1 : 0

if (failed && !process.env.BACKUP_RETRY) {
  console.log(`===== ${stamp()}  trying again in ${RETRY_MIN} min =====`)
  await new Promise(r => setTimeout(r, RETRY_MIN * 60 * 1000))
  const again = spawnSync(process.execPath, [new URL(import.meta.url).pathname], {
    stdio: 'inherit', env: { ...process.env, BACKUP_RETRY: '1' },
  })
  process.exitCode = again.status ?? 1
}
