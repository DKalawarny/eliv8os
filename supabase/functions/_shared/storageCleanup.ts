/**
 * Remove a company's stored files.
 *
 * ⚠️ WHY THIS EXISTS. Every file is stored under `<company_id>/…`, but deleting
 * a company only deletes ROWS: the 11 Nov 2026 audit found files still in
 * storage for five companies that no longer existed (deleted demo copies),
 * and delete-account left a deleted workspace's files behind the same way.
 * Postgres cannot delete storage objects (storage.protect_delete), so this
 * goes through the Storage API with the service role.
 */
// deno-lint-ignore-file no-explicit-any
const BUCKETS = ['knowledge-files', 'safety-documents', 'tool-exports', 'company-assets']

async function listAll(admin: any, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error || !data?.length) break
    for (const e of data) {
      const p = `${prefix}/${e.name}`
      // A folder comes back with no id; walk into it.
      if (e.id == null) out.push(...await listAll(admin, bucket, p))
      else out.push(p)
    }
    if (data.length < 1000) break
  }
  return out
}

/** Deletes everything under `<companyId>/` in every bucket. Returns the count. */
export async function removeCompanyFiles(admin: any, companyId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) throw new Error('bad company id')
  let n = 0
  for (const bucket of BUCKETS) {
    const paths = await listAll(admin, bucket, companyId)
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100))
      if (error) throw new Error(`${bucket}: ${error.message}`)
      n += Math.min(100, paths.length - i)
    }
  }
  return n
}

/**
 * Backstop sweep: top-level folders named for a company that no longer exists.
 * Only ever touches a folder whose name is a UUID with no companies row, so a
 * live company's files can never match.
 */
export async function sweepOrphanCompanyFolders(admin: any): Promise<number> {
  const ids = new Set<string>()
  for (const bucket of BUCKETS) {
    const { data } = await admin.storage.from(bucket).list('', { limit: 1000 })
    for (const e of data ?? []) if (e.id == null && /^[0-9a-f-]{36}$/i.test(e.name)) ids.add(e.name)
  }
  if (!ids.size) return 0
  const { data: live, error } = await admin.from('companies').select('id').in('id', [...ids])
  // Fail closed: if we cannot read companies, delete nothing.
  if (error || !live) return 0
  const alive = new Set(live.map((r: { id: string }) => r.id))
  let n = 0
  for (const id of ids) if (!alive.has(id)) n += await removeCompanyFiles(admin, id)
  return n
}
