import { contextBridge, ipcRenderer } from "electron";

import type {
  OpenPdfSelection,
  PdfViewApi,
  StartPageDragRequest,
  WriteTempPageImageRequest,
  WriteTempPageImageResponse
} from "../shared/types";

const api: PdfViewApi = {
  openPdf: () => ipcRenderer.invoke("open-pdf") as Promise<OpenPdfSelection | null>,
  async readPdfBytes(filePath: string): Promise<ArrayBuffer> {
    const bytes = (await ipcRenderer.invoke("read-pdf-bytes", filePath)) as Uint8Array;
    const copied = new Uint8Array(bytes.byteLength);
    copied.set(bytes);
    return copied.buffer;
  },
  startPageDrag: (request: StartPageDragRequest) => {
    ipcRenderer.send("start-page-drag", request);
    return Promise.resolve();
  },
  writeTempPageImage: (request: WriteTempPageImageRequest) =>
    ipcRenderer.invoke("write-temp-page-image", request) as Promise<WriteTempPageImageResponse>,
  clearDocumentTemp: (documentKey: string) =>
    ipcRenderer.invoke("clear-document-temp", documentKey) as Promise<void>
};

contextBridge.exposeInMainWorld("pdfView", api);
