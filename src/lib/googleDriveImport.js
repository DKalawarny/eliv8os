/**
 * Google Drive import — OAuth via Google Identity Services + Picker API.
 *
 * Credentials (set in .env.local):
 *   VITE_GOOGLE_CLIENT_ID  — OAuth 2.0 web client ID (console.cloud.google.com)
 *   VITE_GOOGLE_API_KEY    — Browser API key with Drive + Picker APIs enabled
 *
 * Setup checklist (one-time, ~15 min):
 *   1. console.cloud.google.com → New project
 *   2. APIs & Services → Enable: "Google Drive API" + "Google Picker API"
 *   3. Credentials → Create OAuth 2.0 Client ID (Web application)
 *      · Add your domain to Authorised JavaScript origins
 *   4. Credentials → Create API Key → restrict to Drive + Picker APIs
 *   5. Copy both values into .env.local
 *
 * Google Workspace files (Docs, Sheets, Slides) are automatically exported
 * as PDF so they flow through the existing extraction pipeline unchanged.
 * All other files (PDF, TXT, Word) are downloaded as-is.
 */

const GD_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const GD_API_KEY   = import.meta.env.VITE_GOOGLE_API_KEY

// Types the picker will show. Workspace types are exported as PDF on download.
const PICKER_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
].join(',')

// Google Workspace types that must be exported (can't download directly)
const WORKSPACE_EXPORT_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
])

// ── Script loading ────────────────────────────────────────────────────────────

let _apisLoaded = false

async function loadGoogleApis() {
  if (_apisLoaded) return

  // 1. Load GAPI (for Picker)
  await new Promise((resolve, reject) => {
    if (window.gapi) { resolve(); return }
    const s = document.createElement('script')
    s.src = 'https://apis.google.com/js/api.js'
    s.onload = resolve
    s.onerror = () => reject(new Error('Failed to load Google API script'))
    document.head.appendChild(s)
  })

  // 2. Initialize the picker library
  await new Promise(resolve => window.gapi.load('picker', resolve))

  // 3. Load Google Identity Services (for OAuth token)
  await new Promise((resolve, reject) => {
    if (window.google?.accounts) { resolve(); return }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.onload = resolve
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })

  _apisLoaded = true
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

/**
 * ⭐ Exported for the freshness check (lib/cloudFreshness.js), which needs a
 * token to ask Drive whether an imported file has changed. Deliberately not
 * cached anywhere: no token is stored, so there is no moment at which this app
 * can read the owner's Drive without him having just authorised it.
 */
export async function getAccessToken() {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GD_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (response.error) reject(new Error(`Google auth error: ${response.error}`))
        else resolve(response.access_token)
      },
      // ⚠️ Without this, closing the Google popup (or the browser blocking
      // it) calls nothing at all, and the caller's spinner waits forever.
      // 29 Oct: Daniel opened it by accident and sat on "Opening Google
      // Drive…". A closed popup is a cancel, not an error.
      error_callback: (err) => {
        const e = new Error(`Google sign-in ${err?.type === 'popup_failed_to_open' ? 'popup was blocked' : 'was closed'}`)
        e.cancelled = err?.type === 'popup_closed'
        reject(e)
      },
    })
    client.requestAccessToken({ prompt: '' })
  })
}

// ── Picker ────────────────────────────────────────────────────────────────────

/**
 * Open the Google Drive file picker.
 * Returns { files: Array<DriveFile>, token: string }
 * where DriveFile = { id, name, mimeType, sizeBytes }
 */
export async function openGoogleDrivePicker() {
  if (!GD_CLIENT_ID || !GD_API_KEY) {
    throw new Error(
      'Google Drive is not configured. Add VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_API_KEY to .env.local'
    )
  }

  await loadGoogleApis()
  const token = await getAccessToken()

  return new Promise((resolve, reject) => {
    const view = new window.google.picker.DocsView()
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setMimeTypes(PICKER_MIME_TYPES)

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(GD_API_KEY)
      // ⚠️ Required with the drive.file scope: picking a file only grants
      // this app access to it when the picker names the Cloud project, i.e.
      // the project number, which is the client ID's prefix. Without it the
      // picker opens fine and the download then 404s.
      .setAppId(GD_CLIENT_ID.split('-')[0])
      .setTitle('Select documents to import')
      .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
      .setCallback((data) => {
        const { Action } = window.google.picker
        if (data.action === Action.PICKED) {
          const files = data.docs.map(f => ({
            id:        f.id,
            name:      f.name,
            mimeType:  f.mimeType,
            sizeBytes: f.sizeBytes ?? 0,
            // The picker hands back the last edit time. Capturing it at import
            // is what later makes "has this changed in Drive?" answerable with
            // one metadata call instead of a standing sync.
            modifiedAt: f.lastEditedUtc ? new Date(f.lastEditedUtc).toISOString() : null,
            provider:  'google',
          }))
          resolve({ files, token })
        } else if (data.action === Action.CANCEL) {
          resolve({ files: [], token })
        } else if (data.action === Action.LOADED) {
          // Picker opened — nothing to do
        }
      })
      .build()

    picker.setVisible(true)
  })
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Download a Drive file and return it as a browser File object.
 * Google Workspace files (Docs, Sheets, Slides) are exported as PDF.
 */
export async function downloadGoogleFile(driveFile, token) {
  const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024 // 15MB safety limit

  let url, outputName, outputMime

  if (WORKSPACE_EXPORT_TYPES.has(driveFile.mimeType)) {
    // Export Google Workspace documents as PDF
    url = `https://www.googleapis.com/drive/v3/files/${driveFile.id}/export?mimeType=application/pdf`
    outputName = driveFile.name.replace(/\.[^.]*$/, '') + '.pdf'
    outputMime = 'application/pdf'
  } else {
    // Direct download for native files
    if (driveFile.sizeBytes > MAX_DOWNLOAD_BYTES) {
      throw new Error(`${driveFile.name} is too large (max 15MB)`)
    }
    url = `https://www.googleapis.com/drive/v3/files/${driveFile.id}?alt=media`
    outputName = driveFile.name
    outputMime = driveFile.mimeType
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Could not download "${driveFile.name}": ${response.status} ${text.slice(0, 120)}`)
  }

  const blob = await response.blob()
  return new File([blob], outputName, { type: outputMime })
}
