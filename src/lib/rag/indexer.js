/**
 * RAG indexer — orchestrates the full chunk → embed → store pipeline.
 *
 * Called automatically after every successful knowledge file upload.
 * Runs entirely in the browser (client-side), so upload progress reflects
 * the indexing work in real time.
 *
 * Pipeline:
 *   1. Split extracted_text into overlapping text chunks (~375 tokens each)
 *   2. For PDFs: render visual pages → describe with Claude Vision → add as
 *      image chunks (charts, diagrams, graphs become searchable text)
 *   3. Batch-embed all chunks with OpenAI text-embedding-3-small
 *   4. Delete old chunks for this file (idempotent — re-upload re-indexes)
 *   5. Insert new chunk rows into document_chunks
 *
 * Graceful degradation:
 *   - If OpenAI key is missing: chunks are stored without embeddings.
 *     The library still works; RAG search returns nothing but naive context
 *     injection continues to function.
 *   - If image extraction fails: logged as a warning, text-only indexing
 *     proceeds. The upload is not blocked.
 *   - If chunk storage fails: error is thrown (upload flow surfaces it as a
 *     non-fatal warning — the file row already exists).
 */

import { supabase }         from '../supabase'
import { chunkText }        from './chunker'
import { embedBatch }       from './embeddings'
import { extractPdfImages } from './imageExtract'

// Vision calls now route through the `claude` Edge Function, which holds
// the Anthropic key server-side. Indexing is always available; no client-
// side env check needed.

/**
 * Index a knowledge file that has already been saved to the database.
 *
 * @param {object}   knowledgeFile   Row from knowledge_files. Must include:
 *                                     id, company_id, extracted_text, mime_type, title
 * @param {File}     [originalFile]  The browser File object — needed for PDF image
 *                                     extraction. Optional; omit to skip image extraction.
 * @param {function} [onProgress]    Progress callback (0..100 float)
 *
 * @returns {{ chunksIndexed: number }}
 */
export async function indexKnowledgeFile(knowledgeFile, originalFile, onProgress) {
  const report = pct => { try { onProgress?.(pct) } catch {} }

  const {
    id:             fileId,
    company_id:     companyId,
    extracted_text: extractedText,
    mime_type:      mimeType,
    title,
  } = knowledgeFile

  // ── 1. Build text chunks ──────────────────────────────────────────────────
  report(5)
  const textChunks = chunkText(extractedText || '')

  // ── 2. Build image chunks (PDFs with visual content only) ─────────────────
  report(15)
  const imageChunks = []

  const isPdf = (mimeType || '').includes('pdf')
    || (originalFile?.name || '').toLowerCase().endsWith('.pdf')

  if (isPdf && originalFile) {
    try {
      // Split extracted text by double newlines as a rough page-per-paragraph
      // approximation — good enough for the "is this page visual?" heuristic.
      const pageTexts = (extractedText || '').split('\n\n')

      const imageDescs = await extractPdfImages(originalFile, pageTexts)

      for (const { pageNumber, description } of imageDescs) {
        if (description?.trim()) {
          imageChunks.push({
            content:    `[Visual content — page ${pageNumber} of "${title}"]\n\n${description}`,
            chunk_type: 'image',
          })
        }
      }

      if (imageChunks.length > 0) {
        console.info(`[RAG] Found ${imageChunks.length} visual page(s) in "${title}"`)
      }
    } catch (err) {
      console.warn('[RAG] Image extraction failed — proceeding with text only:', err)
    }
  }

  report(40)

  // ── 3. Combine all chunks ─────────────────────────────────────────────────
  const allChunks = [
    ...textChunks.map(c => ({ content: c, chunk_type: 'text' })),
    ...imageChunks,
  ]

  if (allChunks.length === 0) {
    console.warn('[RAG] No chunks generated for', title)
    return { chunksIndexed: 0 }
  }

  // ── 4. Embed all chunks ───────────────────────────────────────────────────
  let embeddings
  try {
    embeddings = await embedBatch(allChunks.map(c => c.content))
  } catch (err) {
    // Embedding failure (e.g. bad API key, rate limit) — store without vectors.
    // RAG search won't return results for this file but the upload still works.
    console.warn('[RAG] Embedding failed — chunks will be stored without vectors:', err)
    embeddings = allChunks.map(() => null)
  }

  report(75)

  // ── 5. Delete old chunks (idempotent re-indexing) ─────────────────────────
  await supabase
    .from('document_chunks')
    .delete()
    .eq('knowledge_file_id', fileId)

  // ── 6. Insert new chunks ──────────────────────────────────────────────────
  const rows = allChunks.map((chunk, i) => ({
    knowledge_file_id: fileId,
    company_id:        companyId,
    chunk_index:       i,
    content:           chunk.content,
    chunk_type:        chunk.chunk_type,
    embedding:         embeddings[i] ?? null,
    token_estimate:    Math.ceil(chunk.content.length / 4),
  }))

  const { error } = await supabase
    .from('document_chunks')
    .insert(rows)

  if (error) {
    // Non-fatal — the file is usable via naive injection even without chunks.
    console.error('[RAG] Failed to save chunks:', error.message)
    return { chunksIndexed: 0 }
  }

  report(100)

  console.info(
    `[RAG] Indexed "${title}": ${textChunks.length} text + ${imageChunks.length} image chunks`
  )

  return { chunksIndexed: rows.length }
}

/**
 * Index any of the company's files that have text but no search vectors.
 *
 * ⚠️ WHY. Solomon finds files by vector search. A file stored before search
 * worked (it was dead until August 2026), or one whose embedding call failed,
 * has text but no vectors, so Solomon answered "nothing came back" about a file
 * sitting in the library. The 11 Nov 2026 audit found six such files in one
 * workspace. This repairs them quietly, once per visit. Embeddings are free
 * (gte-small in the embed function); no Vision call is made here.
 */
const healedThisVisit = new Set()

export async function indexMissingFiles(companyId, { max = 10 } = {}) {
  if (!companyId || healedThisVisit.has(companyId)) return { indexed: 0 }
  healedThisVisit.add(companyId)

  const [{ data: files }, { data: chunks }] = await Promise.all([
    supabase
      .from('knowledge_files')
      .select('id, company_id, extracted_text, mime_type, title')
      .eq('company_id', companyId)
      .eq('status', 'ready')
      .not('extracted_text', 'is', null),
    supabase
      .from('document_chunks')
      .select('knowledge_file_id')
      .eq('company_id', companyId)
      .not('embedding', 'is', null)
      .limit(20000),
  ])
  const hasVectors = new Set((chunks ?? []).map(c => c.knowledge_file_id))
  const missing = (files ?? []).filter(f => f.extracted_text?.trim() && !hasVectors.has(f.id)).slice(0, max)

  let indexed = 0
  for (const f of missing) {
    try {
      const { chunksIndexed } = await indexKnowledgeFile(f)
      if (chunksIndexed) indexed += 1
    } catch (err) {
      console.warn('[RAG] could not index', f.title, err)
    }
  }
  if (indexed) console.info(`[RAG] indexed ${indexed} file(s) that had no search vectors`)
  return { indexed }
}
