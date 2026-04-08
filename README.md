# CellMLForge Workspace Manager

The CellMLForge Workspace Manager is a desktop-first application for managing OMEX/COMBINE archives with integrated git version control and GitHub push capabilities. Built as a component of the CellMLForge ecosystem, it supports drag-and-drop file import, automated manifest management, and cross-platform local execution.

## Features

- **Create and manage OMEX archives** with automatic manifest updates
- **Drag-and-drop file import** with collision detection and path normalization
- **Git-tracked working trees** with automatic change detection
- **Commit message suggestion** based on file changes
- **GitHub OAuth authentication** for secure remote push
- **Automatic zip rebuild and base64 generation** for online service integration
- **Cross-platform** support (Windows, macOS, Linux)

## Getting Started

### Prerequisites

- Node.js 14+ and npm 6+
- Git

### Installation

```bash
npm install
```

### Development

Run the app in development mode with hot-reload for both Vue and Electron:

```bash
npm run dev
```

This launches two concurrent processes:
- React dev server on port 3000
- Electron app pointing to the dev server

### Building for Production

Create a packaged installer for your platform:

```bash
npm run dist
```

Outputs platform-specific installers to the `dist/` directory.

### Build TypeScript Only

```bash
npm run build-ts
```

## Architecture

### Project Structure

```
src/
├── main/
│   ├── main.ts              # Electron main process entry
│   ├── ipc-handlers.ts      # IPC message handlers
│   └── preload.ts           # IPC security bridge
├── renderer/                # React UI
│   ├── App.tsx
│   ├── index.tsx
│   └── components/
├── services/                # Business logic
│   ├── workspace.ts         # Workspace creation and import
│   ├── manifest.ts          # OMEX manifest handling
│   ├── git.ts               # Git operations
│   ├── github.ts            # GitHub OAuth and push
│   └── zip.ts               # Zip and base64 generation
└── domain/
    └── models.ts            # Type definitions

dist/                        # Compiled output
public/                      # Static assets
```

### Core Workflows

#### 1. Create Workspace

```
User → Create Project
  → Initialize working directory
  → Initialize git repository
  → Create manifest.xml stub
  → Ready for file import
```

#### 2. Import and Edit Files

```
User → Drag files into UI
  → Validate and copy to working tree
  → Calculate checksums
  → Update manifest entries
  → Mark git state dirty
```

#### 3. Commit and Push

```
User → Review changes
  → Get commit suggestion (auto-generated)
  → Edit commit message
  → Commit to git
  → Rebuild zip artifact
  → Generate base64 version
  → Push to GitHub (or just save locally)
```

### Technology Stack

- **Electron** — Cross-platform desktop runtime
- **React** — UI layer with TypeScript
- **TypeScript** — Type-safe application code
- **JSZip/Archiver** — Zip file handling
- **isomorphic-git** — Git operations (server-safe)
- **@octokit/rest** — GitHub API client
- **xmlbuilder2** — OMEX manifest generation
- **Electron Store** — Secure credential storage

## Development Workflow

### Type Checking

```bash
npm run build-ts
```

### Running Tests (future)

```bash
npm test
```

## Configuration

### GitHub OAuth

To enable GitHub OAuth in development:

1. [Register a new GitHub OAuth App](https://github.com/settings/developers)
2. Set Authorization callback URL to `http://localhost:3000/callback`
3. Create a `.env.local` file:

```env
REACT_APP_GITHUB_CLIENT_ID=your_client_id_here
REACT_APP_GITHUB_CLIENT_SECRET=your_client_secret_here
```

### Manifest Validation

Manifest validation is pragmatic by default (warnings only) for quick iterations. To enable strict schema validation, set:

```env
REACT_APP_STRICT_MANIFEST_VALIDATION=true
```

## Key Design Decisions

1. **Desktop-first MVP** with web companion coming in Phase 2
2. **Full GitHub OAuth flow** in MVP for secure authentication
3. **Pragmatic manifest validation** initially; strict schema validation planned for later phases
4. **Generated artifacts excluded from git** (.zip, .b64 in .gitignore)
5. **Electron framework** chosen for mature desktop integration and node ecosystem access

## Next Steps

### Phase 1: Complete MVP (In Progress)

- [ ] Implement archive creation and opening
- [ ] Implement manifest parser and generator
- [ ] Implement git change detection and commit
- [ ] Implement GitHub OAuth flow
- [ ] Implement zip rebuild and base64 generation
- [ ] Complete React UI with file import and commit flows
- [ ] Test end-to-end workflow

### Phase 2: Web Companion

- [ ] Build Express.js backend for file staging
- [ ] Publish to GitHub Pages
- [ ] Implement metadata-only view mode
- [ ] Add remote operation triggers

### Phase 3: Advanced Features

- [ ] Multi-file conflict resolution
- [ ] Full COMBINE schema validation
- [ ] Git history and blame view
- [ ] Collaborative editing support

## Testing Strategy

- **Unit tests** for manifest updater, git operations, zip generation
- **Integration tests** for end-to-end workflows (create → import → commit → push)
- **Manual QA** for edge cases (large files, binary files, path collisions)

## Troubleshooting

### "Cannot find module" errors

Ensure TypeScript compilation succeeded:

```bash
npm run build-ts
```

Then restart the dev server:

```bash
npm run dev
```

### GitHub OAuth fails

Check that your OAuth app credentials are set in `.env.local` and the callback URL matches your app configuration.

### Electron app won't start

Verify that React dev server is running on port 3000:

```bash
lsof -i :3000
```

If port 3000 is in use, React will prompt for an alternative port. Update the Electron app URL if needed.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or pull request for features or bug fixes.
