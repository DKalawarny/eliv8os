/**
 * Microsoft OneDrive import — MSAL.js popup auth + Microsoft Graph API.
 *
 * Credentials (set in .env.local):
 *   VITE_ONEDRIVE_CLIENT_ID  — Application (client) ID from Azure app registration
 *
 * Setup checklist (one-time, ~20 min):
 *   1. portal.azure.com → Azure Active Directory → App registrations → New
 *   2. Name: "Eliv8 OS", Supported account types: "Accounts in any org + personal"
 *   3. Redirect URI → Single-page application → https://your-domain.com
 *      (use http://localhost:5173 for local dev)
 *   4. API permissions → Add → Microsoft Graph → Delegated:
 *      "Files.Read" + "Files.Read.All" + "User.Read"
 *   5. Copy the "Application (client) ID" into .env.local
 *
 * This module builds a custom file browser using the Graph API since
 * Microsoft's native picker SDK has limited web app support. The UI lives
 * in CloudImportModal.jsx and calls these functions directly.
 */

import { PublicClientApplication } from '@azure/msal-browser'

const OD_CLIENT_ID = import.meta.env.VITE_ONEDRIVE_CLIENT_ID

// Graph API base
const GRAPH = 'https://graph.microsoft.com/v1.0'

// File extensions we want to show in the browser
const ALLOWED_EXTS = new Set([
  '.pdf',
  '.txt', '.md', '.markdown',
  '.doc', '.docx',
  '.xls', '.xlsx', '.csv',
  '.ppt', '.pptx',
  '.rtf',
])

// ── MSAL instance ─────────────────────────────────────────────────────────────

let _msalInstance = null

async function getMsalInstance() {
  if (_msalInstance) return _msalInstance

  const config = {
    auth: {
      clientId:    OD_CLIENT_ID,
      authority:   'https://login.microsoftonline.com/common',
      redirectUri: `${window.location.origin}/auth-redirect.html`,
    },
    cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
    // ⚠️ MSAL gives the popup 60s by default, and that one window holds the
    // sign-in, the two-step code and the permission screen. 29 Oct: Daniel's
    // first real try read the permission screen, clicked Accept and got
    // "timed_out". Five minutes is a person reading, not a hung popup.
    system: { popupBridgeTimeout: 300_000 },
  }

  _msalInstance = new PublicClientApplication(config)
  await _msalInstance.initialize()
  return _msalInstance
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

const SCOPES = ['Files.Read', 'Files.Read.All', 'User.Read']

let _cachedToken = null
let _tokenExpiry = 0

/**
 * Get a valid Graph API access token.
 * Tries silent first (uses cached session), falls back to a login popup.
 */
export async function getOneDriveToken() {
  if (!OD_CLIENT_ID) {
    throw new Error(
      'OneDrive is not configured. Add VITE_ONEDRIVE_CLIENT_ID to .env.local'
    )
  }

  // Return cached token if still valid (with 60s buffer)
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken

  const msal = await getMsalInstance()
  const request = { scopes: SCOPES }

  try {
    const accounts = msal.getAllAccounts()
    if (accounts.length > 0) {
      const result = await msal.acquireTokenSilent({ ...request, account: accounts[0] })
      _cachedToken = result.accessToken
      _tokenExpiry = result.expiresOn?.getTime() ?? (Date.now() + 3600_000)
      return _cachedToken
    }
  } catch {
    // Silent failed — fall through to popup
  }

  const result = await msal.loginPopup(request)
  _cachedToken = result.accessToken
  _tokenExpiry = result.expiresOn?.getTime() ?? (Date.now() + 3600_000)
  return _cachedToken
}

/**
 * Returns the display name + email of the signed-in Microsoft account,
 * or null if no account is cached yet.
 */
export async function getOneDriveAccount() {
  if (!OD_CLIENT_ID) return null
  const msal = await getMsalInstance()
  const accounts = msal.getAllAccounts()
  if (!accounts.length) return null
  return {
    name:  accounts[0].name     ?? null,
    email: accounts[0].username ?? null,
  }
}

// ── Graph API helpers ─────────────────────────────────────────────────────────

async function graphGet(path, token) {
  const url = path.startsWith('https://') ? path : `${GRAPH}${path}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Microsoft Graph error ${res.status}: ${text.slice(0, 120)}`)
  }
  return res.json()
}

// Fetches all pages of a Graph list endpoint, following @odata.nextLink
async function graphGetAll(path, token) {
  const items = []
  let next = path
  while (next) {
    const data = await graphGet(next, token)
    items.push(...(data.value ?? []))
    next = data['@odata.nextLink'] ?? null
  }
  return items
}

/**
 * List files and folders at a given OneDrive path.
 * Pass itemId = null for the root, or a drive item ID for a subfolder.
 * Pass driveId to browse a SharePoint/shared drive instead of personal drive.
 *
 * Returns { folders, files } where files are filtered to supported types only.
 */
export async function listOneDriveFolder(token, itemId = null, driveId = null) {
  const path = driveId
    ? itemId
      ? `/drives/${driveId}/items/${itemId}/children`
      : `/drives/${driveId}/root/children`
    : itemId
      ? `/me/drive/items/${itemId}/children`
      : '/me/drive/root/children'

  const items = await graphGetAll(`${path}?$select=id,name,size,file,folder,parentReference&$top=200`, token)

  const folders = items
    .filter(i => i.folder)
    .map(i => ({ id: i.id, name: i.name, type: 'folder', driveId }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const files = items
    .filter(i => i.file && isAllowedFile(i.name))
    .map(i => ({
      id:        i.id,
      name:      i.name,
      sizeBytes: i.size ?? 0,
      mimeType:  i.file?.mimeType ?? 'application/octet-stream',
      provider:  'onedrive',
      driveId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { folders, files }
}

/**
 * List all drives + SharePoint sites the user has access to.
 * Combines /me/drives (personal + followed) with /sites?search=* (all org sites).
 * Returns array of { id, name, driveType, siteId? } sorted by name.
 */
export async function listAvailableDrives(token) {
  const results = []

  // 1. Personal + followed drives
  try {
    const drives = await graphGetAll(
      '/me/drives?$select=id,name,driveType,owner&$top=50',
      token
    )
    drives.forEach(d => results.push({
      id:        d.id,
      name:      d.name ?? 'My Drive',
      driveType: d.driveType,
    }))
  } catch { /* ignore — will surface SharePoint results */ }

  // 2. All SharePoint sites in the organisation (requires Sites.Read.All)
  try {
    const sites = await graphGetAll(
      '/sites?search=*&$select=id,name,displayName,webUrl&$top=50',
      token
    )
    // For each site, fetch its document libraries
    await Promise.allSettled(sites.map(async site => {
      try {
        const siteDrives = await graphGetAll(
          `/sites/${site.id}/drives?$select=id,name,driveType&$top=20`,
          token
        )
        siteDrives.forEach(d => {
          // Avoid duplicates already in /me/drives
          if (!results.find(r => r.id === d.id)) {
            results.push({
              id:        d.id,
              name:      `${site.displayName ?? site.name} — ${d.name}`,
              driveType: 'documentLibrary',
              siteId:    site.id,
            })
          }
        })
      } catch { /* skip sites we can't read */ }
    }))
  } catch { /* Sites.Read.All not granted — only /me/drives available */ }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * List files shared with the signed-in user by others.
 * Returns a flat files array (no folders — shared items are top-level).
 */
export async function listSharedWithMe(token) {
  const items = await graphGetAll(
    '/me/drive/sharedWithMe?$select=id,name,size,file,folder,remoteItem&$top=200',
    token
  )

  const folders = items
    .filter(i => i.folder || i.remoteItem?.folder)
    .map(i => ({
      id:      i.remoteItem?.id      ?? i.id,
      name:    i.name,
      type:    'folder',
      driveId: i.remoteItem?.parentReference?.driveId ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const files = items
    .filter(i => (i.file || i.remoteItem?.file) && isAllowedFile(i.name))
    .map(i => ({
      id:        i.remoteItem?.id      ?? i.id,
      name:      i.name,
      sizeBytes: i.size ?? 0,
      mimeType:  (i.file ?? i.remoteItem?.file)?.mimeType ?? 'application/octet-stream',
      provider:  'onedrive',
      driveId:   i.remoteItem?.parentReference?.driveId ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { folders, files }
}

/**
 * Search OneDrive for files matching a query string.
 * Returns files array filtered to supported types.
 */
export async function searchOneDrive(token, query) {
  const encoded = encodeURIComponent(query)
  const items = await graphGetAll(
    `/me/drive/root/search(q='${encoded}')?$select=id,name,size,file,folder,parentReference&$top=100`,
    token
  )
  return items
    .filter(i => i.file && isAllowedFile(i.name))
    .map(i => ({
      id:        i.id,
      name:      i.name,
      sizeBytes: i.size ?? 0,
      mimeType:  i.file?.mimeType ?? 'application/octet-stream',
      provider:  'onedrive',
      driveId:   i.parentReference?.driveId ?? null,
    }))
}

/**
 * Recursively fetch ALL files inside a folder (and its subfolders).
 * Returns a flat array of DriveFile objects ready for import.
 */
export async function fetchAllFilesInFolder(token, folderId, driveId = null, depth = 0) {
  if (depth > 5) return [] // safety cap — don't recurse more than 5 levels
  const { folders, files } = await listOneDriveFolder(token, folderId, driveId)
  const subFiles = await Promise.all(
    folders.map(f => fetchAllFilesInFolder(token, f.id, f.driveId ?? driveId, depth + 1))
  )
  return [...files, ...subFiles.flat()]
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Download a OneDrive file and return it as a browser File object.
 */
export async function downloadOneDriveFile(driveFile, token) {
  const MAX_BYTES = 15 * 1024 * 1024
  if (driveFile.sizeBytes > MAX_BYTES) {
    throw new Error(`"${driveFile.name}" is too large (max 15MB)`)
  }

  // Get a download URL — use drive-specific path for shared/SharePoint files
  const itemPath = driveFile.driveId
    ? `/drives/${driveFile.driveId}/items/${driveFile.id}?select=@microsoft.graph.downloadUrl`
    : `/me/drive/items/${driveFile.id}?select=@microsoft.graph.downloadUrl`
  const meta = await graphGet(itemPath, token)
  const downloadUrl = meta['@microsoft.graph.downloadUrl']

  if (!downloadUrl) throw new Error(`Could not get download URL for "${driveFile.name}"`)

  const response = await fetch(downloadUrl)
  if (!response.ok) throw new Error(`Download failed for "${driveFile.name}": ${response.status}`)

  const blob = await response.blob()
  return new File([blob], driveFile.name, { type: driveFile.mimeType })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAllowedFile(name) {
  const lower = (name || '').toLowerCase()
  return [...ALLOWED_EXTS].some(ext => lower.endsWith(ext))
}
