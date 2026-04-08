# OMEX Archive Manager - Development Guide

This is a desktop-first application for managing OMEX/COMBINE archives with local git integration and GitHub OAuth authentication.

## Architecture

- **Electron** for desktop packaging (Windows, macOS, Linux)
- **React** for UI layer
- **TypeScript** for type safety and domain modeling
- **IPC Bridge** between main process and renderer for file I/O and git operations
- **Services Layer** for archive management, git operations, GitHub auth, and manifest handling

## Project Structure

```
src/
├── main/                 # Electron main process
│   ├── main.ts          # App entry point
│   ├── ipc-handlers.ts  # IPC message handlers (file I/O, git, etc)
│   └── preload.ts       # Preload script for IPC
├── renderer/            # React UI
│   ├── App.tsx
│   ├── index.tsx
│   └── components/
├── services/            # Business logic
│   ├── workspace.ts     # Workspace create/open/import/export
│   ├── manifest.ts      # OMEX manifest parsing and generation
│   ├── git.ts           # Git operations and change detection
│   ├── github.ts        # GitHub OAuth and API interactions
│   └── zip.ts           # Zip rebuild and base64 generation
└── domain/              # Type definitions and interfaces
    └── models.ts        # Core entities and state machine

dist/                    # Compiled output
public/                  # Static assets
```

## Core Workflows

### 1. Create New Workspace (MVP)
- User initiates new project
- App creates working directory structure
- Initialize git repo with .gitignore (excludes *.zip, *.b64)
- Create empty manifest.xml stub
- UI shows empty archive ready for file import

### 2. Drag-and-Drop File Import
- User drags files/folders onto UI
- App validates paths and checks for collisions
- Files copied to working tree
- Manifest entries added/updated with checksums
- Git change state marked dirty
- Commit prompt offered

### 3. Manifest Update (Pragmatic)
- On file add: create entry with path, media-type, format, description
- On file change: update format/checksum/timestamp
- On file delete: remove entry
- Baseline validation: required fields, path existence, no duplicates
- Warn but don't block on missing optional fields initially

### 4. Commit and Push Flow
- Detect changes from working tree
- Generate commit suggestion from operation types and diff summary
- Show editable commit message prompt
- User approves and commits via git
- Rebuild zip artifact (excluded from git)
- Regenerate base64 artifact
- Prompt for push target and branch
- Execute push via GitHub REST API (requires OAuth token)

### 5. GitHub OAuth Integration
- User clicks "Sign in to GitHub"
- Open browser for OAuth consent flow
- Receive and store token securely (Electron Store with encryption)
- Display user name and avatar in header
- Support token refresh and revocation recovery

## Development

### Install Dependencies
```bash
npm install
```

### Run Development Mode
```bash
npm run dev
```
Launches concurrent processes: React dev server (port 3000) and Electron app pointing to it.

### Build for Production
```bash
npm run dist
```
Produces packaged installers for current platform.

### Build TypeScript Only
```bash
npm run build-ts
```

## Testing Strategy (Future)

- Unit tests for manifest updater, zip builder, base64 generation
- Integration tests for create archive → import files → commit → push
- Manual QA matrix across platforms with edge cases (large files, binary, invalid paths)

## Key Dependencies

- **electron**: Desktop runtime
- **react**: UI framework
- **jszip/archiver**: Zip file handling
- **isomorphic-git**: Git operations (cross-platform, pure JS)
- **nodegit**: Alternative git for full CLI feature access if needed
- **@octokit/rest**: GitHub API client
- **xmlbuilder2**: OMEX manifest generation

## Decisions Locked

- Desktop-first MVP (web companion in Phase 2)
- Full GitHub OAuth in MVP (not just PAT)
- Pragmatic OMEX validation first (strict schema validation later)
- Exclude generated zip/base64 artifacts from git tracking
- Electron framework chosen (approved in spike phase)

## Next Steps

1. Complete type definitions for domain models and state machine
2. Implement archive service (create, open, import, export stubs)
3. Implement manifest updater with pragmatic validation
4. Implement git change detection and commit suggestion
5. Implement GitHub OAuth flow and token storage
6. Wire initial React UI with drag-drop handler
7. Build IPC bridge between main and renderer processes
8. Implement zip rebuild and base64 generation
9. End-to-end test: new archive → add files → commit → push
