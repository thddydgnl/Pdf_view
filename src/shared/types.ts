export interface OpenPdfSelection {
  filePath: string;
  name: string;
}

export type RenderStatus = "idle" | "rendering" | "rendered" | "error";
export type DragAssetStatus = "idle" | "preparing" | "ready" | "error";

export interface PdfDocumentState {
  filePath: string;
  name: string;
  fingerprint: string;
  pageCount: number;
}

export interface PageViewState {
  pageNumber: number;
  renderStatus: RenderStatus;
  dragAssetStatus: DragAssetStatus;
}

export interface WriteTempPageImageRequest {
  documentKey: string;
  pageNumber: number;
  pngBytes: Uint8Array;
}

export interface WriteTempPageImageResponse {
  pngPath: string;
}

export interface StartPageDragRequest {
  documentKey: string;
  pageNumber: number;
  pngPath: string;
}

export interface PdfViewApi {
  openPdf: () => Promise<OpenPdfSelection | null>;
  readPdfBytes: (filePath: string) => Promise<ArrayBuffer>;
  startPageDrag: (request: StartPageDragRequest) => Promise<void>;
  writeTempPageImage: (request: WriteTempPageImageRequest) => Promise<WriteTempPageImageResponse>;
  clearDocumentTemp: (documentKey: string) => Promise<void>;
}
