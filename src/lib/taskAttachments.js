import { supabase }     from './supabase'
import { getSignedUrl } from './knowledgeFiles'

// Task attachments live in the same private bucket as knowledge files, under
// the company folder (first path segment), so existing storage RLS applies.
// They are tracked in work_order_attachments, NOT knowledge_files, so they are
// never indexed for Solomon — a file that rides along with the task, nothing more.
const BUCKET = 'knowledge-files'
const MAX_BYTES = 50 * 1024 * 1024
export const TASK_ATTACH_MAX_MB = 50

const sanitize = name => (name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120)

export function validateAttachment(file) {
  if (!file) return 'No file.'
  if (file.size > MAX_BYTES) return `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — max is ${TASK_ATTACH_MAX_MB}MB.`
  return null
}

export async function listTaskAttachments(workOrderId) {
  if (!workOrderId) return []
  const { data, error } = await supabase
    .from('work_order_attachments')
    .select('*')
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function uploadTaskAttachment({ file, companyId, workOrderId, userId }) {
  const err = validateAttachment(file)
  if (err) throw new Error(err)
  if (!companyId || !workOrderId) throw new Error('Missing task context.')

  const path = `${companyId}/${crypto.randomUUID()}-${sanitize(file.name)}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

  const { data, error } = await supabase
    .from('work_order_attachments')
    .insert({
      company_id: companyId, work_order_id: workOrderId, uploaded_by: userId,
      title: file.name, file_path: path, mime_type: file.type || null, size_bytes: file.size,
    })
    .select().single()
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => null)
    throw new Error(`Save failed: ${error.message}`)
  }
  return data
}

export async function deleteTaskAttachment(att) {
  await supabase.from('work_order_attachments').delete().eq('id', att.id)
  await supabase.storage.from(BUCKET).remove([att.file_path]).catch(() => null)
}

// Call BEFORE deleting the task. The task's delete cascades its attachment
// rows away, but the files stay in storage with nothing pointing to them, so
// a file the owner deleted would still exist (found in the 11 Nov audit).
export async function removeFilesForTask(workOrderId) {
  const atts = await listTaskAttachments(workOrderId).catch(() => [])
  const paths = atts.map(a => a.file_path).filter(Boolean)
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => null)
}

export async function openTaskAttachment(att) {
  const url = await getSignedUrl(att.file_path, 300)
  window.open(url, '_blank', 'noopener')
}
