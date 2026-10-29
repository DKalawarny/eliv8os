/**
 * CloudImportModal — unified Google Drive + OneDrive file picker.
 *
 * Flow:
 *   1. Provider selection (Google Drive / OneDrive cards)
 *   2a. Google Drive: native picker overlay opens → files returned → go to Review
 *   2b. OneDrive: inline custom file browser (folder nav + search + multi-select)
 *   3. Review — list of selected files, uncheck to remove any before importing
 *   4. Importing — per-file download → upload progress
 *   5. Done — summary, close
 *
 * Props:
 *   companyId  — required for uploadKnowledgeFile
 *   userId     — required for uploadKnowledgeFile
 *   onClose    — called when the modal should be dismissed
 *   onUploaded — called once per successfully imported row (so parent can add it)
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { openGoogleDrivePicker, downloadGoogleFile }    from '../../lib/googleDriveImport'
import {
  getOneDriveToken,
  getOneDriveAccount,
  listOneDriveFolder,
  listSharedWithMe,
  listAvailableDrives,
  fetchAllFilesInFolder,
  searchOneDrive,
  downloadOneDriveFile,
} from '../../lib/oneDriveImport'
import { uploadKnowledgeFile } from '../../lib/knowledgeFiles'

// ─── Phase constants ────────────────────────────────────────────────────────

const PHASE = {
  PICK:       'pick',       // provider selection
  BROWSE_OD:  'browse-od', // OneDrive custom browser
  REVIEW:     'review',    // file review / deselect step
  IMPORTING:  'importing', // per-file import in progress
  DONE:       'done',      // all finished
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export default function CloudImportModal({ companyId, userId, onClose, onUploaded }) {
  const [phase,    setPhase]    = useState(PHASE.PICK)
  const [selected, setSelected] = useState([])   // DriveFile[] to import
  const [gdToken,  setGdToken]  = useState(null) // Google access token (for download)
  const [odToken,  setOdToken]  = useState(null) // OneDrive access token
  const [results,  setResults]  = useState([])   // ImportResult[] for done screen
  const [busyMsg,  setBusyMsg]  = useState(null) // top-level busy state message
  const [odAccount, setOdAccount] = useState(null) // { name, email } of signed-in MS account

  // Close on Escape (not during import)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && phase !== PHASE.IMPORTING) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [phase, onClose])

  // ── Google Drive ────────────────────────────────────────────────────────────

  const handleGooglePick = async () => {
    setBusyMsg('Opening Google Drive…')
    try {
      const { files, token } = await openGoogleDrivePicker()
      if (!files.length) { setBusyMsg(null); return }
      setGdToken(token)
      setSelected(files)
      setPhase(PHASE.REVIEW)
    } catch (err) {
      if (!err.cancelled) alert(`Google Drive: ${err.message}`)
    } finally {
      setBusyMsg(null)
    }
  }

  // ── OneDrive ────────────────────────────────────────────────────────────────

  const handleOneDriveOpen = async () => {
    setBusyMsg('Signing in to OneDrive…')
    try {
      const token = await getOneDriveToken()
      setOdToken(token)
      const account = await getOneDriveAccount()
      setOdAccount(account)
      setPhase(PHASE.BROWSE_OD)
    } catch (err) {
      alert(`OneDrive: ${err.message}`)
    } finally {
      setBusyMsg(null)
    }
  }

  const handleOdSelectionDone = async (files, folders) => {
    if (folders && Object.keys(folders).length > 0) {
      setOdToken(odToken)
      setBusyMsg('Reading folders…')
      try {
        const folderFiles = await Promise.all(
          Object.values(folders).map(f =>
            fetchAllFilesInFolder(odToken, f.id, f.driveId ?? null)
          )
        )
        const allFiles = [...files, ...folderFiles.flat()]
        // Deduplicate by id
        const seen = new Set()
        const unique = allFiles.filter(f => {
          if (seen.has(f.id)) return false
          seen.add(f.id); return true
        })
        setSelected(unique)
      } catch (err) {
        alert(`Could not read folder contents: ${err.message}`)
        setSelected(files)
      } finally {
        setBusyMsg(null)
      }
    } else {
      setSelected(files)
    }
    setPhase(PHASE.REVIEW)
  }

  // ── Import ──────────────────────────────────────────────────────────────────

  const handleImport = async (filesToImport) => {
    setPhase(PHASE.IMPORTING)
    const outcomes = []

    for (const driveFile of filesToImport) {
      outcomes.push({ file: driveFile, status: 'pending', error: null })
    }
    setResults([...outcomes])

    for (let i = 0; i < filesToImport.length; i++) {
      const driveFile = filesToImport[i]
      try {
        // Step 1: Download from the cloud provider
        let browserFile
        if (driveFile.provider === 'google') {
          browserFile = await downloadGoogleFile(driveFile, gdToken)
        } else {
          browserFile = await downloadOneDriveFile(driveFile, odToken)
        }

        // Step 2: Upload through the normal pipeline
        const row = await uploadKnowledgeFile(browserFile, {
          companyId,
          userId,
          title: driveFile.name.replace(/\.[^.]+$/, ''),
          kind:  'general',
          notes: `Imported from ${driveFile.provider === 'google' ? 'Google Drive' : 'OneDrive'}`,
          source: {
            provider:   driveFile.provider,
            fileId:     driveFile.id,
            modifiedAt: driveFile.modifiedAt ?? null,
          },
          onProgress: () => {},
        })

        outcomes[i] = { file: driveFile, status: 'done', row }
        onUploaded(row)
      } catch (err) {
        outcomes[i] = { file: driveFile, status: 'error', error: err.message ?? 'Import failed' }
      }
      setResults([...outcomes])
    }

    setPhase(PHASE.DONE)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={() => phase !== PHASE.IMPORTING && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-ink-100 overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
        role="dialog" aria-modal="true"
      >
        {/* Dark header */}
        <div className="bg-ink-900 px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-brand-400 font-semibold mb-0.5">
              Knowledge Library
            </div>
            <h2 className="text-base font-bold text-white">
              {phase === PHASE.PICK       && 'Import from cloud storage'}
              {phase === PHASE.BROWSE_OD  && 'Browse OneDrive'}
              {phase === PHASE.REVIEW     && `Review ${selected.length} file${selected.length !== 1 ? 's' : ''}`}
              {phase === PHASE.IMPORTING  && 'Importing files…'}
              {phase === PHASE.DONE       && 'Import complete'}
            </h2>
          </div>
          {phase !== PHASE.IMPORTING && (
            <button
              type="button" onClick={onClose}
              aria-label="Close"
              className="text-ink-400 hover:text-white text-2xl leading-none transition-colors"
            >
              ×
            </button>
          )}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto">
          {busyMsg && <BusyOverlay message={busyMsg} />}

          {phase === PHASE.PICK && (
            <ProviderPick
              onGoogle={handleGooglePick}
              onOneDrive={handleOneDriveOpen}
            />
          )}

          {phase === PHASE.BROWSE_OD && odToken && (
            <OneDriveBrowser
              token={odToken}
              account={odAccount}
              onDone={handleOdSelectionDone}
              onBack={() => setPhase(PHASE.PICK)}
            />
          )}

          {phase === PHASE.REVIEW && (
            <ReviewStep
              files={selected}
              onImport={handleImport}
              onBack={() => setPhase(PHASE.PICK)}
            />
          )}

          {phase === PHASE.IMPORTING && (
            <ImportProgress results={results} />
          )}

          {phase === PHASE.DONE && (
            <DoneScreen results={results} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  )
}

// Detect which providers are configured via env vars
const GD_CONFIGURED = !!(
  import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_API_KEY
)
const OD_CONFIGURED = !!import.meta.env.VITE_ONEDRIVE_CLIENT_ID

// ─── Phase: Provider selection ───────────────────────────────────────────────

function ProviderPick({ onGoogle, onOneDrive }) {
  return (
    <div className="p-6 space-y-4">
      <p className="text-sm text-ink-500 leading-relaxed">
        Browse your cloud storage and pick specific files to add to your knowledge library. Only the files you select will be imported. Nothing syncs automatically.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 mt-2">
        <ProviderCard
          icon={<GoogleIcon />}
          name="Google Drive"
          desc="PDFs, Docs, Sheets, Slides, Word files, text files"
          onClick={onGoogle}
          configured={GD_CONFIGURED}
          setupNote="Add VITE_GOOGLE_CLIENT_ID + VITE_GOOGLE_API_KEY to .env.local"
        />
        <ProviderCard
          icon={<OneDriveIcon />}
          name="Microsoft OneDrive"
          desc="PDFs, Word docs, text files, Markdown"
          onClick={onOneDrive}
          configured={OD_CONFIGURED}
          setupNote="Add VITE_ONEDRIVE_CLIENT_ID to .env.local"
        />
      </div>

      <p className="text-xs text-ink-400 text-center pt-2">
        Files are only readable by you and your team. We never store your cloud credentials.
      </p>
    </div>
  )
}

function ProviderCard({ icon, name, desc, onClick, configured, setupNote }) {
  if (!configured) {
    return (
      <div className="flex flex-col gap-3 p-5 rounded-xl border border-ink-100 bg-ink-50/60 opacity-70 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 flex-shrink-0 rounded-xl bg-white flex items-center justify-center border border-ink-100 grayscale opacity-60">
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-bold text-ink-700">{name}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400 bg-ink-200 px-1.5 py-0.5 rounded">
                Not set up
              </span>
            </div>
            <div className="text-xs text-ink-400 leading-relaxed">{desc}</div>
          </div>
        </div>
        {setupNote && (
          <div className="flex items-start gap-2 rounded-lg bg-white border border-ink-200 px-3 py-2">
            <span className="text-ink-400 flex-shrink-0 mt-0.5">ℹ</span>
            <p className="text-[11px] text-ink-500 leading-relaxed font-mono">{setupNote}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-4 p-5 rounded-xl border border-ink-100 bg-white hover:border-brand-300 hover:bg-brand-50/30 text-left transition-colors group shadow-sm"
    >
      <div className="w-12 h-12 flex-shrink-0 rounded-xl bg-ink-50 group-hover:bg-white flex items-center justify-center transition-colors border border-ink-100">
        {icon}
      </div>
      <div>
        <div className="text-sm font-bold text-ink-900 mb-0.5">{name}</div>
        <div className="text-xs text-ink-400 leading-relaxed">{desc}</div>
      </div>
    </button>
  )
}

// ─── Phase: OneDrive custom browser ─────────────────────────────────────────

function OneDriveBrowser({ token, account, onDone, onBack }) {
  const [tab,           setTab]          = useState('mine')
  const [stack,         setStack]        = useState([{ id: null, name: 'My Drive' }])
  const [listing,       setListing]      = useState(null)
  const [listErr,       setListErr]      = useState(null)
  const [checked,       setChecked]      = useState({})        // { [fileId]: DriveFile }
  const [checkedFolders,setCheckedFolders] = useState({})      // { [folderId]: folder }
  const [resolving,     setResolving]    = useState(false)     // expanding folders into files
  const [query,         setQuery]        = useState('')
  const [results,       setResults]      = useState(null)
  const [searching,     setSearching]    = useState(false)
  const [drives,        setDrives]       = useState(null)
  const debounceRef = useRef(null)

  const currentFolderId = stack[stack.length - 1].id
  const currentDriveId  = stack[stack.length - 1].driveId ?? null

  // Load drives list once when switching to libraries tab
  useEffect(() => {
    if (tab !== 'libraries' || drives !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const list = await listAvailableDrives(token)
        if (!cancelled) setDrives(list)
      } catch (err) {
        if (!cancelled) setDrives({ error: err.message })
      }
    })()
    return () => { cancelled = true }
  }, [tab, token, drives])

  // Load folder contents (or shared-with-me list)
  useEffect(() => {
    // Libraries tab at root shows drive list — no folder to load
    if (tab === 'libraries' && stack.length === 1) return
    let cancelled = false
    setListing(null)
    setListErr(null)
    setResults(null)
    setQuery('')
    ;(async () => {
      try {
        const data = tab === 'shared' && stack.length === 1
          ? await listSharedWithMe(token)
          : await listOneDriveFolder(token, currentFolderId, currentDriveId)
        if (!cancelled) setListing(data)
      } catch (err) {
        if (!cancelled) setListErr(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [token, tab, currentFolderId, currentDriveId])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults(null); setSearching(false); return }

    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await searchOneDrive(token, query.trim())
        setResults(hits)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [query, token])

  // ⚠️ Ticks survive moving between folders and tabs: `checked` is keyed by
  // file id and holds the whole file, so nothing about it is tied to the folder
  // on screen. 29 Oct, Daniel: every folder meant tick, import, come back in,
  // go to the next folder. One basket for the whole visit; the review step
  // lists everything before anything is imported.
  const navigate = (folder) => {
    setStack(s => [...s, { id: folder.id, name: folder.name, driveId: folder.driveId ?? null }])
  }

  const switchTab = (t) => {
    setTab(t)
    setStack([
      t === 'shared'    ? { id: null, name: 'Shared with me' } :
      t === 'libraries' ? { id: null, name: 'Company Libraries' } :
                          { id: null, name: 'My Drive' }
    ])
    setListing(null)
    setResults(null)
    setQuery('')
    // Force fresh drive list on every switch to libraries
    if (t === 'libraries') setDrives(null)
  }

  const openDrive = (drive) => {
    setStack([{ id: null, name: 'Company Libraries' }, { id: null, name: drive.name, driveId: drive.id }])
  }

  const goBack = () => {
    if (stack.length > 1) setStack(s => s.slice(0, -1))
    else onBack()
  }

  const toggleFile = (file) => {
    setChecked(prev => {
      const next = { ...prev }
      if (next[file.id]) delete next[file.id]
      else next[file.id] = file
      return next
    })
  }

  const checkedCount        = Object.keys(checked).length
  const checkedFolderCount  = Object.keys(checkedFolders).length
  const totalSelected       = checkedCount + checkedFolderCount
  const displayItems        = results ?? listing
  const visibleFiles        = results ?? (listing?.files ?? [])
  const visibleFolders      = results ? [] : (listing?.folders ?? [])
  const allFilesSelected    = visibleFiles.length === 0   || visibleFiles.every(f => !!checked[f.id])
  const allFoldersSelected  = visibleFolders.length === 0 || visibleFolders.every(f => !!checkedFolders[f.id])
  const hasAnything         = visibleFiles.length > 0 || visibleFolders.length > 0
  const allSelected         = hasAnything && allFilesSelected && allFoldersSelected

  const toggleFolder = (folder) => {
    setCheckedFolders(prev => {
      const next = { ...prev }
      if (next[folder.id]) delete next[folder.id]
      else next[folder.id] = folder
      return next
    })
  }

  const toggleAll = () => {
    if (allSelected) {
      // Only what is on screen: picks made in other folders stay picked.
      const nextFiles = { ...checked }
      visibleFiles.forEach(f => { delete nextFiles[f.id] })
      setChecked(nextFiles)
      const nextFolders = { ...checkedFolders }
      visibleFolders.forEach(f => { delete nextFolders[f.id] })
      setCheckedFolders(nextFolders)
    } else {
      const nextFiles = { ...checked }
      visibleFiles.forEach(f => { nextFiles[f.id] = f })
      setChecked(nextFiles)
      const nextFolders = { ...checkedFolders }
      visibleFolders.forEach(f => { nextFolders[f.id] = f })
      setCheckedFolders(nextFolders)
    }
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 400 }}>
      {/* Toolbar: breadcrumb + search */}
      <div className="px-5 pt-4 pb-3 border-b border-ink-100 space-y-3 flex-shrink-0">
        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-ink-50 rounded-lg">
          {[
            { id: 'mine',      label: 'My Drive' },
            { id: 'shared',    label: 'Shared' },
            { id: 'libraries', label: 'Company Libraries' },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-colors ${
                tab === t.id
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Account pill */}
        {account && (
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-blue-600">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <span className="text-xs text-ink-500">
              Signed in as <span className="font-semibold text-ink-700">{account.name || account.email}</span>
              {account.name && account.email && <span className="text-ink-400"> · {account.email}</span>}
            </span>
          </div>
        )}
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs text-ink-500 flex-wrap">
          {stack.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-ink-300">/</span>}
              <button
                type="button"
                onClick={() => {
                  if (i < stack.length - 1) setStack(s => s.slice(0, i + 1))
                }}
                className={`${i === stack.length - 1 ? 'text-ink-900 font-semibold' : 'hover:text-brand-600 transition-colors'}`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>

        {/* Select all row */}
        {hasAnything && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
            >
              {allSelected ? '✓ Deselect all' : '+ Select all'}
            </button>
            {totalSelected > 0 && (
              <span className="text-xs text-ink-400">{totalSelected} selected</span>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm" aria-hidden>🔍</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search OneDrive…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-ink-200 text-sm text-ink-900 bg-white focus:border-brand-400 focus:ring-0 outline-none"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <span className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin block" />
            </span>
          )}
        </div>
      </div>

      {/* File browser */}
      <div className="flex-1 overflow-y-auto px-5 py-3">

        {/* Company Libraries — drive picker */}
        {tab === 'libraries' && stack.length === 1 && (
          drives === null ? (
            <div className="space-y-2 pt-1">
              {[1,2,3].map(i => <div key={i} className="h-11 bg-ink-50 rounded-lg animate-pulse" />)}
            </div>
          ) : drives?.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold mb-1">Could not load company libraries</p>
              <p className="text-xs font-mono">{drives.error}</p>
              <p className="text-xs mt-2 text-red-600">This usually means the app needs admin consent in your company's Microsoft 365 tenant, or you're signed in with a personal account instead of your work email.</p>
            </div>
          ) : drives.length === 0 ? (
            <div className="text-center py-10 text-sm text-ink-400">
              <p className="font-medium mb-1">No company libraries found</p>
              <p className="text-xs text-ink-400 max-w-xs mx-auto">Make sure you signed in with your work email, not a personal Microsoft account. Your IT admin may also need to approve Eliv8 OS in your company's Azure portal.</p>
            </div>
          ) : (
            <ul className="space-y-1 pt-1">
              {drives.map(drive => (
                <li key={drive.id}>
                  <button
                    type="button"
                    onClick={() => openDrive(drive)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-ink-50 text-left transition-colors"
                  >
                    <span className="text-lg flex-shrink-0" aria-hidden>🏢</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink-700 font-medium truncate">{drive.name}</p>
                      <p className="text-[11px] text-ink-400 capitalize">{drive.driveType === 'documentLibrary' ? 'SharePoint library' : drive.driveType}</p>
                    </div>
                    <span className="text-ink-300 text-xs">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {(tab !== 'libraries' || stack.length > 1) && listErr && !results && (

          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {listErr}
          </div>
        )}

        {(tab !== 'libraries' || stack.length > 1) && !displayItems && !listErr && (
          <div className="space-y-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-11 bg-ink-50 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {(tab !== 'libraries' || stack.length > 1) && displayItems && !displayItems.folders?.length && !displayItems.files?.length && (
          <div className="text-center py-10 text-sm text-ink-400">
            {results ? 'No matching files found.' : 'This folder is empty.'}
          </div>
        )}

        {(tab !== 'libraries' || stack.length > 1) && displayItems && (
          <ul className="space-y-1">
            {/* Folders — with checkbox to import whole folder */}
            {!results && (displayItems.folders ?? []).map(folder => (
              <li key={folder.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!checkedFolders[folder.id]}
                  onChange={() => toggleFolder(folder)}
                  className="w-4 h-4 ml-3 rounded border-ink-300 text-brand-600 focus:ring-brand-500 flex-shrink-0"
                  title="Import entire folder"
                />
                <button
                  type="button"
                  onClick={() => navigate(folder)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-ink-50 text-left transition-colors flex-1 min-w-0"
                >
                  <span className="text-lg flex-shrink-0" aria-hidden>📁</span>
                  <span className="text-sm text-ink-700 font-medium flex-1 truncate">{folder.name}</span>
                  <span className="text-ink-300 text-xs">›</span>
                </button>
              </li>
            ))}

            {/* Files with checkboxes */}
            {(results ?? (displayItems.files ?? [])).map(file => (
              <li key={file.id}>
                <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-ink-50 cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={!!checked[file.id]}
                    onChange={() => toggleFile(file)}
                    className="w-4 h-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-lg flex-shrink-0" aria-hidden>
                    {fileIcon(file.name)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink-900 truncate">{file.name}</span>
                    {file.sizeBytes > 0 && (
                      <span className="text-xs text-ink-400">{formatBytes(file.sizeBytes)}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer: back + select all + done */}
      <div className="px-5 py-4 border-t border-ink-100 bg-ink-50/40 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goBack}
            className="px-4 py-2 rounded-lg border border-ink-200 bg-white hover:bg-ink-50 text-sm text-ink-700 font-medium transition-colors"
          >
            ← Back
          </button>
        </div>
        <button
          type="button"
          disabled={totalSelected === 0}
          onClick={() => onDone(Object.values(checked), checkedFolders)}
          className="px-5 py-2.5 rounded-lg bg-gold-gradient text-white text-sm font-bold tracking-wide glow-gold-sm hover:glow-gold disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
        >
          {totalSelected === 0
            ? 'Select files or folders'
            : `Import ${totalSelected} item${totalSelected !== 1 ? 's' : ''} →`}
        </button>
      </div>
    </div>
  )
}

// ─── Phase: Review / deselect ────────────────────────────────────────────────

function ReviewStep({ files, onImport, onBack }) {
  const [kept, setKept] = useState(() => new Set(files.map(f => f.id)))

  const toggle = (id) => setKept(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const toImport = files.filter(f => kept.has(f.id))

  return (
    <div className="flex flex-col" style={{ minHeight: 300 }}>
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <p className="text-sm text-ink-500">
          Uncheck any files you don't want to add, for example, documents from a different business.
        </p>
      </div>

      <ul className="flex-1 overflow-y-auto px-5 space-y-2 pb-4">
        {files.map(file => {
          const on = kept.has(file.id)
          return (
            <li key={file.id}>
              <label
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                  on
                    ? 'border-brand-200 bg-brand-50/30'
                    : 'border-ink-100 bg-ink-50/50 opacity-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(file.id)}
                  className="w-4 h-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-xl flex-shrink-0" aria-hidden>{fileIcon(file.name)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink-900 truncate">{file.name}</div>
                  <div className="text-xs text-ink-400 flex items-center gap-1.5 mt-0.5">
                    <span>{file.provider === 'google' ? 'Google Drive' : 'OneDrive'}</span>
                    {file.sizeBytes > 0 && (
                      <><span>·</span><span>{formatBytes(file.sizeBytes)}</span></>
                    )}
                  </div>
                </div>
              </label>
            </li>
          )
        })}
      </ul>

      <div className="px-5 py-4 border-t border-ink-100 bg-ink-50/40 flex items-center justify-between flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-lg border border-ink-200 bg-white hover:bg-ink-50 text-sm text-ink-700 font-medium transition-colors"
        >
          ← Change selection
        </button>
        <button
          type="button"
          disabled={toImport.length === 0}
          onClick={() => onImport(toImport)}
          className="px-5 py-2.5 rounded-lg bg-gold-gradient text-white text-sm font-bold tracking-wide glow-gold-sm hover:glow-gold disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
        >
          {toImport.length === 0
            ? 'Select at least one file'
            : `Import ${toImport.length} file${toImport.length !== 1 ? 's' : ''} →`}
        </button>
      </div>
    </div>
  )
}

// ─── Phase: Import progress ──────────────────────────────────────────────────

function ImportProgress({ results }) {
  return (
    <div className="px-5 py-6 space-y-3">
      <p className="text-sm text-ink-500 mb-4">
        Downloading and adding files to your library… don't close this window.
      </p>
      {results.map((r, i) => (
        <div key={i} className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-xl flex-shrink-0" aria-hidden>{fileIcon(r.file.name)}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink-900 truncate">{r.file.name}</div>
              <div className="text-xs text-ink-400 mt-0.5">{statusLabel(r.status)}</div>
            </div>
            <StatusBadge status={r.status} />
          </div>
          {r.status === 'error' && r.error && (
            <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
              {r.error}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Phase: Done ─────────────────────────────────────────────────────────────

function DoneScreen({ results, onClose }) {
  const succeeded = results.filter(r => r.status === 'done').length
  const failed    = results.filter(r => r.status === 'error').length

  return (
    <div className="px-5 py-8 text-center space-y-5">
      <div className="text-4xl" aria-hidden>{failed === 0 ? '🎉' : '⚠️'}</div>

      <div>
        <h3 className="text-lg font-bold text-ink-900 mb-1">
          {succeeded} file{succeeded !== 1 ? 's' : ''} imported
        </h3>
        {failed > 0 && (
          <p className="text-sm text-amber-700">
            {failed} file{failed !== 1 ? 's' : ''} couldn't be imported, see errors above.
          </p>
        )}
        {failed === 0 && (
          <p className="text-sm text-ink-500">
            Your library has been updated. Solomon will use these documents the next time you ask for advice.
          </p>
        )}
      </div>

      {/* Result list */}
      <div className="text-left space-y-2 max-w-md mx-auto">
        {results.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <StatusBadge status={r.status} small />
            <span className={`truncate ${r.status === 'error' ? 'text-red-700' : 'text-ink-700'}`}>
              {r.file.name}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-2 px-6 py-2.5 rounded-xl bg-ink-900 hover:bg-ink-800 text-white text-sm font-bold tracking-wide transition-colors"
      >
        Close
      </button>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BusyOverlay({ message }) {
  return (
    <div className="absolute inset-0 z-10 bg-white/80 flex flex-col items-center justify-center gap-3">
      <span className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      <p className="text-sm text-ink-600 font-medium">{message}</p>
    </div>
  )
}

function StatusBadge({ status, small }) {
  const size = small ? 'text-base' : 'text-lg'
  if (status === 'pending')  return <span className={`${size} flex-shrink-0`} aria-label="pending">⏳</span>
  if (status === 'done')     return <span className={`${size} flex-shrink-0`} aria-label="done">✅</span>
  if (status === 'error')    return <span className={`${size} flex-shrink-0`} aria-label="error">❌</span>
  // importing (in progress)
  return <span className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin flex-shrink-0" aria-label="importing" />
}

function statusLabel(s) {
  if (s === 'pending')  return 'Waiting…'
  if (s === 'done')     return 'Imported ✓'
  if (s === 'error')    return 'Failed'
  return 'Downloading and processing…'
}

// ─── Provider SVG icons ───────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.9 2.2 30.3 0 24 0 14.7 0 6.7 5.4 2.9 13.2l7.9 6.1C12.6 13 17.9 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.9-2.2 5.4-4.7 7l7.3 5.7c4.3-4 6.8-9.9 6.8-16.7z"/>
      <path fill="#FBBC05" d="M10.8 28.7A14.7 14.7 0 019.5 24c0-1.7.3-3.3.8-4.8l-7.9-6.1A23.9 23.9 0 000 24c0 3.9.9 7.5 2.5 10.8l8.3-6.1z"/>
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2.1 1.4-4.9 2.2-8.6 2.2-6.1 0-11.3-4.1-13.2-9.6l-8.3 6.1C6.7 42.7 14.7 48 24 48z"/>
    </svg>
  )
}

function OneDriveIcon() {
  return (
    <svg width="30" height="22" viewBox="0 0 21 15" aria-hidden>
      <path fill="#0364B8" d="M12.5 14.8l6.3-3.6c1.4-.8 2.2-2.2 2.2-3.8 0-2.4-2-4.4-4.4-4.4-.3 0-.6 0-.9.1A6.2 6.2 0 002.5 7.1L1.2 9c-.7.4-1.2 1.1-1.2 2 0 1.3 1 2.3 2.2 2.3l10.3 1.5z"/>
      <path fill="#0078D4" d="M7.9 5.4a5 5 0 016 1.6 3.8 3.8 0 01.7-.1 3.9 3.9 0 013.9 3.9c0 .4-.1.8-.2 1.1l-1.8 1-9.8-1.4A5 5 0 017.9 5.4z"/>
      <path fill="#1490DF" d="M1.2 9l1.3-1.9a6.2 6.2 0 0111-3.9 3.8 3.8 0 00-.6 0 3.9 3.9 0 00-3.7 2.7 4.4 4.4 0 00-3.5 4.2l-3.3.5C1.1 10.6.5 9.8 1.2 9z"/>
    </svg>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fileIcon(name) {
  const lower = (name || '').toLowerCase()
  if (lower.endsWith('.pdf'))              return '📕'
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return '📘'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return '📝'
  return '📄'
}

function formatBytes(b) {
  if (!b || b <= 0) return ''
  if (b < 1024)        return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
