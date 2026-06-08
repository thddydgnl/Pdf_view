# PDF Page Drag Viewer

Lightweight desktop viewer for dragging a PDF page directly into a browser chat as a single PNG upload. The app disables text selection and renders pages as page cards.

## Features

- Vertical page list rendered with `pdf.js`
- Drag a page body straight into a browser chat upload target
- Lazy page rendering near the viewport

## Requirements

Install Node.js LTS before running or packaging the project.

## Run

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Windows package:

```bash
npm run dist:win
```

macOS package:

```bash
npm run dist:mac
```

On macOS the distributable output is a `.dmg` and a `.zip` containing the `.app`, which is the closest equivalent to a Windows `.exe`.

Note: code signing and notarization are not configured yet, so unsigned macOS builds may show a Gatekeeper warning on first launch.

## Scope

- Windows installer supported
- macOS package output supported
- Browser-based chat targets
- One PDF open at a time
- No text selection, highlighting, or PDF export in v1
