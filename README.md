# PDF Page Drag Viewer

Lightweight Windows desktop viewer for dragging a PDF page directly into a browser chat as a single PNG upload. The app disables text selection, renders pages as page cards, and stores per-page study progress by PDF fingerprint.

## Features

- Vertical page list rendered with `pdf.js`
- Drag a page body straight into a browser chat upload target
- Persistent per-page study checkbox state
- Progress indicator for checked pages
- Lazy page rendering near the viewport

## Requirements

This workspace did not have `node`, `npm`, or `git` available on PATH during implementation. Install Node.js LTS before running the project.

## Run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Scope

- Windows only
- Browser-based chat targets
- One PDF open at a time
- No text selection, highlighting, or PDF export in v1
