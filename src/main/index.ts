import { app, BrowserWindow, dialog, ipcMain, nativeImage, type OpenDialogOptions } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type {
  OpenPdfSelection,
  StartPageDragRequest,
  WriteTempPageImageRequest,
  WriteTempPageImageResponse
} from "../shared/types";

let mainWindow: BrowserWindow | null = null;

const APP_NAME = "PdfView";

function getRendererUrl(): string {
  return process.env.VITE_DEV_SERVER_URL ?? "";
}

function getRendererIndexPath(): string {
  return path.join(__dirname, "../../dist/renderer/index.html");
}

function getWindowIconPath(): string {
  return path.join(__dirname, "../../build/icon.png");
}

function getLocalTempRoot(): string {
  const base = process.env.LOCALAPPDATA ?? app.getPath("temp");
  return path.join(base, APP_NAME, "temp");
}

function sanitizeFilenameSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function ensureDirectories(): Promise<void> {
  await fsp.mkdir(getLocalTempRoot(), { recursive: true });
}

async function clearTempRoot(): Promise<void> {
  await fsp.rm(getLocalTempRoot(), { force: true, recursive: true });
  await fsp.mkdir(getLocalTempRoot(), { recursive: true });
}

async function clearDocumentTemp(documentKey: string): Promise<void> {
  const prefix = `${sanitizeFilenameSegment(documentKey)}-`;
  const root = getLocalTempRoot();

  if (!fs.existsSync(root)) {
    return;
  }

  const entries = await fsp.readdir(root, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => fsp.rm(path.join(root, entry.name), { force: true }))
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 520,
    minHeight: 520,
    autoHideMenuBar: true,
    backgroundColor: "#edf2f7",
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = getRendererUrl();

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(getRendererIndexPath());
  }

  return window;
}

function registerIpc(): void {
  ipcMain.handle("open-pdf", async (): Promise<OpenPdfSelection | null> => {
    const dialogOptions: OpenDialogOptions = {
      title: "Open PDF",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      properties: ["openFile"]
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    return {
      filePath,
      name: path.basename(filePath)
    };
  });

  ipcMain.handle("read-pdf-bytes", async (_event, filePath: string): Promise<Uint8Array> => {
    const buffer = await fsp.readFile(filePath);
    return new Uint8Array(buffer);
  });

  ipcMain.handle(
    "write-temp-page-image",
    async (_event, request: WriteTempPageImageRequest): Promise<WriteTempPageImageResponse> => {
      const filename = `${sanitizeFilenameSegment(request.documentKey)}-${request.pageNumber}.png`;
      const targetPath = path.join(getLocalTempRoot(), filename);

      await fsp.mkdir(getLocalTempRoot(), { recursive: true });
      await fsp.writeFile(targetPath, request.pngBytes);

      return {
        pngPath: targetPath
      };
    }
  );

  ipcMain.on("start-page-drag", (event, request: StartPageDragRequest) => {
    if (!fs.existsSync(request.pngPath)) {
      return;
    }

    const dragIcon = nativeImage.createFromPath(request.pngPath).resize({
      width: 18,
      height: 18,
      quality: "best"
    });

    event.sender.startDrag({
      file: request.pngPath,
      icon: dragIcon
    });
  });

  ipcMain.handle("clear-document-temp", async (_event, documentKey: string): Promise<void> => {
    await clearDocumentTemp(documentKey);
  });
}

app.setName(APP_NAME);

app.whenReady().then(async () => {
  await ensureDirectories();
  await clearTempRoot();
  registerIpc();
  mainWindow = createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void clearTempRoot();
});
