/**
 * OpenAI embeddings — vector embedding for RAG chunks.
 *
 * We use OpenAI's text-embedding-3-small because:
 *
 *   1. It's the model every embedding column in our migrations is sized for
 *      (vector(1536) — see migrations 001, 012, 013, 022). Switching models
 *      means a column-retype migration and a re-embedding pass, neither of
 *      which is currently worth doing for marginal recall gains.
 *
 *   2. Cost: $0.02 per million tokens. Indexing a 300-page book is well
 *      under a cent. Cheaper than Voyage AI's voyage-3 ($0.06/MT) and
 *      basically negligible at our scale.
 *
 *   3. Recall on business prose (SOPs, financial docs, conversational text)
 *      is good enough — the difference between text-embedding-3-small and
 *      a state-of-the-art retrieval model rarely shows up in real Q&A
 *      against a single tenant's document library.
 *
 *   Model:      Supabase gte-small, run inside the `embed` Edge Function
 *   Dimensions: 384 (matches the pgvector columns after migration 029)
 *   Max input:  ~512 tokens per text; the chunker stays well under
 *   Batch size: 128 texts per call
 *
 * Setup:
 *   supabase functions deploy embed
 *   No API key. No vendor. Inference runs in the Edge Runtime itself.
 *
 * History worth keeping:
 *   This read import.meta.env.VITE_OPENAI_API_KEY and called api.openai.com
 *   from the browser. Vite inlines VITE_ vars, so that key would have shipped
 *   to every visitor — the same failure that retired VITE_ANTHROPIC_API_KEY.
 *   It was never set, which is why embed() returned null and the whole RAG
 *   layer sat dead from April until this was fixed. Never reintroduce a
 *   VITE_-prefixed credential.
 *
 * Graceful degradation:
 *   If the function isn't deployed the client gets a 404, embed() returns
 *   null, and callers skip storing vectors. Uploads and the library still
 *   work; only search is off. Same pattern as search.js and indexer.js.
 */

import { supabase } from '../supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const EMBED_URL    = `${SUPABASE_URL}/functions/v1/embed`

export const EMBEDDING_DIMS = 384

// Conservative per-input cap. text-embedding-3-small accepts up to 8,191
// tokens (~32k chars); we slice well below that so a single oversized
// chunk can't fail the whole batch. The chunker tries to keep chunks ~375
// tokens, so this is just a safety belt.
const MAX_CHARS_PER_INPUT = 8_000

// ⚠️ Batch size is set by the embed function's CPU budget, not by any API.
// gte-small runs inside the Edge Runtime, and one call that runs too long is
// killed with 546 WORKER_RESOURCE_LIMIT. 23 Oct: the first Google Drive
// import (45 chunks of ~1,300 chars) went in one call, hit that, and the
// whole file was stored with no vectors. Measured then: 4 of the longest
// chunks take ~1.6-2.1s and pass; 8 can fail.
const BATCH_SIZE = 4


/**
 * Post one batch to the Edge Function. Returns embeddings in input order, or
 * an array of nulls when embeddings are switched off server-side.
 */
async function callEmbedFunction(inputs) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    console.warn('[RAG] no session — embeddings skipped')
    return inputs.map(() => null)
  }

  const res = await fetch(EMBED_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ texts: inputs }),
  })

  // 404 means the function isn't deployed yet. A configuration state, not an
  // error — retrieval is simply off until `supabase functions deploy embed`.
  if (res.status === 404) {
    console.warn('[RAG] embed function not deployed — retrieval disabled')
    return inputs.map(() => null)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`embed function error ${res.status}: ${body.slice(0, 200)}`)
  }

  const { embeddings } = await res.json()
  return Array.isArray(embeddings) ? embeddings : inputs.map(() => null)
}

/**
 * Embed a single string. Returns a float[] of length 1536, or null when
 * embeddings are unavailable.
 *
 * @param   {string}         text
 * @returns {number[]|null}
 */
export async function embed(text) {
  const [vec] = await callEmbedFunction([text.slice(0, MAX_CHARS_PER_INPUT)])
  return vec ?? null
}


/**
 * Embed multiple strings in batched API calls.
 * Returns embeddings in the same order as the input.
 *
 * @param   {string[]}          texts
 * @returns {(number[]|null)[]}
 */
export async function embedBatch(texts) {
  if (!texts.length) return []

  const results = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts
      .slice(i, i + BATCH_SIZE)
      .map(t => t.slice(0, MAX_CHARS_PER_INPUT))
    results.push(...await embedOrSplit(batch))
  }
  return results
}

/**
 * One batch, halved and retried while the function runs out of compute, so a
 * batch of unusually long chunks costs only itself. A single chunk that still
 * fails comes back null rather than failing the file.
 */
async function embedOrSplit(batch) {
  try {
    return await callEmbedFunction(batch)
  } catch (err) {
    if (!/embed function error 546/.test(err.message)) throw err
    if (batch.length === 1) {
      console.warn('[RAG] embed ran out of compute on one chunk; storing it without a vector')
      return [null]
    }
    const mid = Math.ceil(batch.length / 2)
    return [...await embedOrSplit(batch.slice(0, mid)), ...await embedOrSplit(batch.slice(mid))]
  }
}
