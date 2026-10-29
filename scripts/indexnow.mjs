/**
 * Tell Bing (and the other IndexNow engines) every page we publish, right after
 * a deploy. ChatGPT search runs on Bing, and an assistant is the only channel
 * that has ever brought either product a stranger (18 Oct 2026).
 *
 * ⚠️ The key is not a secret: IndexNow proves ownership by fetching
 * https://<host>/<key>.txt and comparing. That file is public/<key>.txt.
 * ⚠️ Never fails a deploy. A ping Bing did not take (no answer, 429 or 5xx) is
 * tried twice more, 10 and 30 seconds later (Daniel, 29 Oct 2026); after that
 * it waits for the next deploy. Any other 4xx is the key or the urls, and
 * sending it again would only get the same answer.
 *
 * Run: node scripts/indexnow.mjs   (npm run deploy runs it after upload)
 */
import fs from 'fs'

const KEY = '8cc28190803ba086f00246f5fc7ab890'
const WAITS = [10000, 30000]
const SITES = [
  { host: 'getunstuckmap.com', sitemap: 'public/sitemap-unstuckmap.xml' },
  { host: 'eliv8os.com', sitemap: 'public/sitemap.xml' },
]

for (const { host, sitemap } of SITES) {
  try {
    const urls = [...fs.readFileSync(sitemap, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map(m => m[1].trim())
      .filter(u => new URL(u).hostname === host)
    if (!urls.length) { console.log(`[indexnow] ${host}: no urls in ${sitemap}, skipped`); continue }
    for (let i = 0; ; i++) {
      let res, why
      try {
        res = await fetch('https://api.indexnow.org/indexnow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key: KEY, keyLocation: `https://${host}/${KEY}.txt`, urlList: urls }),
          signal: AbortSignal.timeout(30000),
        })
        // 200 and 202 both mean received. 403 is a key the engine could not read.
        console.log(`[indexnow] ${host}: ${urls.length} urls → ${res.status} ${res.statusText}`)
        if (res.status !== 429 && res.status < 500) break
        why = `answered ${res.status}`
      } catch (err) {
        why = `not sent (${err.message})`
      }
      if (i >= WAITS.length) { console.log(`[indexnow] ${host}: ${why}, giving up until the next deploy`); break }
      console.log(`[indexnow] ${host}: ${why}, trying again in ${WAITS[i] / 1000}s`)
      await new Promise(r => setTimeout(r, WAITS[i]))
    }
  } catch (err) {
    console.log(`[indexnow] ${host}: not sent (${err.message})`)
  }
}
