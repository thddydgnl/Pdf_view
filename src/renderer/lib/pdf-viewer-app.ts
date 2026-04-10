import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy
} from "pdfjs-dist/legacy/build/pdf.mjs";

import type {
  OpenPdfSelection,
  PageViewState,
  PdfDocumentState,
  PdfViewApi
} from "../../shared/types";

const DISPLAY_MAX_WIDTH = 1100;
const DRAG_OUTPUT_WIDTH = 1600;
const OBSERVER_ROOT_MARGIN = "1200px 0px";

type ToastTone = "info" | "error";

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback) => number;
};

type PageRecord = {
  state: PageViewState;
  article: HTMLElement;
  shell: HTMLDivElement;
  placeholder: HTMLDivElement;
  pageProxy?: PDFPageProxy;
  renderTask?: ReturnType<PDFPageProxy["render"]>;
  renderedWidth?: number;
  dragAssetPath?: string;
  dragAssetJob?: Promise<void>;
};

type DomRefs = {
  openButton: HTMLButtonElement;
  viewer: HTMLElement;
  pageList: HTMLElement;
  emptyState: HTMLElement;
  documentName: HTMLElement;
  currentPageInput: HTMLInputElement;
  totalPagesText: HTMLElement;
  toast: HTMLElement;
};

declare global {
  interface Window {
    pdfView: PdfViewApi;
  }
}

export class PdfViewerApp {
  private readonly dom: DomRefs;
  private readonly defaultEmptyStateMarkup: string;
  private readonly hasBridge: boolean;
  private pdfDocument: PDFDocumentProxy | null = null;
  private documentState: PdfDocumentState | null = null;
  private readonly pageRecords = new Map<number, PageRecord>();
  private observer: IntersectionObserver | null = null;
  private openToken = 0;
  private toastTimer: number | null = null;
  private resizeTimer: number | null = null;
  private currentPage = 0;
  private zoomScale = 1;
  private defaultPageAspectRatio = "16 / 9";
  private basePageWidth = DISPLAY_MAX_WIDTH;

  public constructor() {
    this.dom = {
      openButton: this.requireElement<HTMLButtonElement>("open-pdf-button"),
      viewer: this.requireElement<HTMLElement>("viewer"),
      pageList: this.requireElement<HTMLElement>("page-list"),
      emptyState: this.requireElement<HTMLElement>("empty-state"),
      documentName: this.requireElement<HTMLElement>("document-name"),
      currentPageInput: this.requireElement<HTMLInputElement>("current-page-input"),
      totalPagesText: this.requireElement<HTMLElement>("total-pages-text"),
      toast: this.requireElement<HTMLElement>("toast")
    };
    this.defaultEmptyStateMarkup = this.dom.emptyState.innerHTML;
    this.hasBridge = typeof window.pdfView !== "undefined";
  }

  public async mount(): Promise<void> {
    if (!this.hasBridge) {
      this.dom.openButton.disabled = true;
      this.showToast("This UI must be opened through Electron. Run npm install, then npm run dev.", "error");
      return;
    }

    this.dom.openButton.addEventListener("click", () => {
      void this.openPdf();
    });
    this.dom.currentPageInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      this.commitPageJump();
    });
    this.dom.currentPageInput.addEventListener("blur", () => {
      this.commitPageJump();
    });
    this.dom.viewer.addEventListener("scroll", () => {
      this.updateCurrentPageFromViewport();
    });
    window.addEventListener("keydown", (event) => {
      if (this.shouldIgnoreShortcut(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "f") {
        event.preventDefault();
        void this.fitToWidth();
      }
    });
    this.dom.viewer.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey) {
          return;
        }

        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.08 : -0.08;
        void this.setZoom(this.zoomScale + delta);
      },
      { passive: false }
    );

    window.addEventListener("resize", () => {
      if (this.resizeTimer !== null) {
        window.clearTimeout(this.resizeTimer);
      }

      this.resizeTimer = window.setTimeout(() => {
        void this.rerenderVisiblePages();
        this.updateCurrentPageFromViewport();
      }, 160);
    });
  }

  private requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);

    if (!element) {
      throw new Error(`Missing required element: ${id}`);
    }

    return element as T;
  }

  private async openPdf(): Promise<void> {
    if (!this.hasBridge) {
      this.showToast("Desktop bridge unavailable. Start the app with npm run dev.", "error");
      return;
    }

    const selection = await window.pdfView.openPdf();

    if (!selection) {
      return;
    }

    const token = ++this.openToken;
    await this.resetDocument();
    this.setLoadingState(selection);

    try {
      const bytes = await window.pdfView.readPdfBytes(selection.filePath);
      const loadingTask = getDocument({
        data: new Uint8Array(bytes)
      });
      const pdfDocument = await loadingTask.promise;

      if (token !== this.openToken) {
        await pdfDocument.destroy();
        return;
      }

      const fingerprint =
        pdfDocument.fingerprints?.[0] ??
        (pdfDocument as PDFDocumentProxy & { fingerprint?: string }).fingerprint ??
        selection.filePath;
      const documentState: PdfDocumentState = {
        filePath: selection.filePath,
        name: selection.name,
        fingerprint,
        pageCount: pdfDocument.numPages
      };
      const firstPage = await pdfDocument.getPage(1);
      const firstViewport = firstPage.getViewport({
        scale: 1,
        rotation: firstPage.rotate
      });
      this.defaultPageAspectRatio = `${firstViewport.width} / ${firstViewport.height}`;
      this.basePageWidth = Math.floor(firstViewport.width);
      this.zoomScale = this.getFitToWidthScale();

      if (token !== this.openToken) {
        await pdfDocument.destroy();
        return;
      }

      this.pdfDocument = pdfDocument;
      this.documentState = documentState;
      this.renderDocumentShell(documentState);

      const warmupPages = Array.from({ length: Math.min(3, documentState.pageCount) }, (_value, index) => index + 1);
      warmupPages.forEach((pageNumber) => {
        void this.ensurePageRendered(pageNumber);
        void this.ensureDragAsset(pageNumber);
      });
    } catch (error) {
      console.error(error);
      await this.resetDocument();
      this.showToast("Could not read the PDF. It may be encrypted or damaged.", "error");
    }
  }

  private setLoadingState(selection: OpenPdfSelection): void {
    this.dom.documentName.textContent = selection.name;
    this.dom.currentPageInput.value = "0";
    this.dom.totalPagesText.textContent = "0";
    this.dom.emptyState.hidden = false;
    this.dom.pageList.hidden = true;
    this.dom.emptyState.innerHTML = "";
  }

  private renderDocumentShell(documentState: PdfDocumentState): void {
    this.dom.emptyState.hidden = true;
    this.dom.pageList.hidden = false;
    this.dom.pageList.replaceChildren();
    this.pageRecords.clear();
    this.dom.documentName.textContent = documentState.name;
    this.dom.totalPagesText.textContent = String(documentState.pageCount);
    this.currentPage = documentState.pageCount > 0 ? 1 : 0;
    this.dom.currentPageInput.value = String(this.currentPage);
    this.updateZoomUi();

    for (let pageNumber = 1; pageNumber <= documentState.pageCount; pageNumber += 1) {
      const record = this.createPageRecord(pageNumber);
      this.pageRecords.set(pageNumber, record);
      this.dom.pageList.append(record.article);
    }

    this.installObserver();
    this.updateCurrentPageFromViewport();
  }

  private createPageRecord(pageNumber: number): PageRecord {
    const article = document.createElement("article");
    article.className = "page-card";

    const shell = document.createElement("div");
    shell.className = "page-card__shell";
    shell.draggable = true;
    shell.style.aspectRatio = this.defaultPageAspectRatio;

    const placeholder = document.createElement("div");
    placeholder.className = "page-card__placeholder";
    shell.append(placeholder);

    article.append(shell);

    const record: PageRecord = {
      state: {
        pageNumber,
        renderStatus: "idle",
        dragAssetStatus: "idle"
      },
      article,
      shell,
      placeholder
    };

    shell.addEventListener("dragstart", (event) => {
      this.handleDragStart(event, pageNumber);
    });

    return record;
  }

  private installObserver(): void {
    this.observer?.disconnect();

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber);

          if (!pageNumber) {
            return;
          }

          if (entry.isIntersecting) {
            void this.ensurePageRendered(pageNumber);
            void this.ensureDragAsset(pageNumber);
          } else {
            this.releaseRenderedPage(pageNumber);
          }
        });

        this.updateCurrentPageFromViewport();
      },
      {
        root: this.dom.viewer,
        rootMargin: OBSERVER_ROOT_MARGIN,
        threshold: 0
      }
    );

    this.pageRecords.forEach((record, pageNumber) => {
      record.article.dataset.pageNumber = String(pageNumber);
      this.observer?.observe(record.article);
    });
  }

  private handleDragStart(event: DragEvent, pageNumber: number): void {
    const record = this.pageRecords.get(pageNumber);
    const documentState = this.documentState;

    event.preventDefault();

    if (!record || !documentState) {
      return;
    }

    if (!record.dragAssetPath) {
      void this.ensureDragAsset(pageNumber);
      return;
    }

    try {
      void window.pdfView.startPageDrag({
        documentKey: documentState.fingerprint,
        pageNumber,
        pngPath: record.dragAssetPath
      });
    } catch (error) {
      console.error(error);
      this.showToast("Could not start the external drag.", "error");
    }
  }

  private async ensurePageRendered(pageNumber: number): Promise<void> {
    const record = this.pageRecords.get(pageNumber);

    if (!record || !this.pdfDocument) {
      return;
    }

    const desiredWidth = this.getDisplayWidth(record.shell);

    if (record.state.renderStatus === "rendering") {
      return;
    }

    if (record.state.renderStatus === "rendered" && record.renderedWidth === desiredWidth) {
      return;
    }

    record.renderTask?.cancel();
    record.state.renderStatus = "rendering";

    try {
      const page = await this.getPageProxy(pageNumber);
      const viewport = page.getViewport({
        scale: 1,
        rotation: page.rotate
      });
      const scale = desiredWidth / viewport.width;
      const scaledViewport = page.getViewport({
        scale,
        rotation: page.rotate
      });
      const outputScale = window.devicePixelRatio || 1;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas context unavailable");
      }

      canvas.className = "page-card__canvas";
      canvas.width = Math.floor(scaledViewport.width * outputScale);
      canvas.height = Math.floor(scaledViewport.height * outputScale);
      canvas.style.width = `${Math.floor(scaledViewport.width)}px`;
      canvas.style.height = `${Math.floor(scaledViewport.height)}px`;
      record.shell.style.aspectRatio = `${scaledViewport.width} / ${scaledViewport.height}`;

      const renderContext = {
        canvasContext: context,
        viewport: scaledViewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0]
      };

      const renderTask = page.render(renderContext);
      record.renderTask = renderTask;
      await renderTask.promise;

      record.renderTask = undefined;
      record.renderedWidth = desiredWidth;
      record.state.renderStatus = "rendered";
      record.shell.replaceChildren(canvas);
    } catch (error) {
      if ((error as Error).name === "RenderingCancelledException") {
        return;
      }

      console.error(error);
      record.renderTask = undefined;
      record.state.renderStatus = "error";
      record.shell.replaceChildren(record.placeholder);
    }
  }

  private releaseRenderedPage(pageNumber: number): void {
    const record = this.pageRecords.get(pageNumber);

    if (!record || record.state.renderStatus === "idle") {
      return;
    }

    if (record.state.renderStatus === "rendering") {
      record.renderTask?.cancel();
      record.renderTask = undefined;
    }

    record.renderedWidth = undefined;
    record.state.renderStatus = "idle";
    record.shell.replaceChildren(record.placeholder);
  }

  private async rerenderVisiblePages(): Promise<void> {
    const jobs: Promise<void>[] = [];
    const viewerRect = this.dom.viewer.getBoundingClientRect();

    this.pageRecords.forEach((record, pageNumber) => {
      const rect = record.article.getBoundingClientRect();
      const withinVerticalBuffer =
        rect.bottom >= viewerRect.top - 800 && rect.top <= viewerRect.bottom + 800;

      if (withinVerticalBuffer) {
        jobs.push(this.ensurePageRendered(pageNumber));
      }
    });

    await Promise.all(jobs);
  }

  private async ensureDragAsset(pageNumber: number): Promise<void> {
    const record = this.pageRecords.get(pageNumber);
    const documentState = this.documentState;

    if (!record || !documentState) {
      return;
    }

    if (record.state.dragAssetStatus === "ready" || record.state.dragAssetStatus === "preparing") {
      return;
    }

    record.state.dragAssetStatus = "preparing";

    const job = this.runWhenIdle(async () => {
      const page = await this.getPageProxy(pageNumber);

      if (this.documentState?.fingerprint !== documentState.fingerprint) {
        return;
      }

      const baseViewport = page.getViewport({
        scale: 1,
        rotation: page.rotate
      });
      const scale = DRAG_OUTPUT_WIDTH / baseViewport.width;
      const viewport = page.getViewport({
        scale,
        rotation: page.rotate
      });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas context unavailable");
      }

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      const renderTask = page.render({
        canvasContext: context,
        viewport
      });

      await renderTask.promise;

      if (this.documentState?.fingerprint !== documentState.fingerprint) {
        return;
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (!value) {
            reject(new Error("Failed to create page blob"));
            return;
          }

          resolve(value);
        }, "image/png");
      });

      const pngBytes = new Uint8Array(await blob.arrayBuffer());
      const response = await window.pdfView.writeTempPageImage({
        documentKey: documentState.fingerprint,
        pageNumber,
        pngBytes
      });

      if (this.documentState?.fingerprint !== documentState.fingerprint) {
        return;
      }

      record.dragAssetPath = response.pngPath;
      record.state.dragAssetStatus = "ready";
    });

    record.dragAssetJob = job.catch((error) => {
      console.error(error);
      record.state.dragAssetStatus = "error";
    });

    await record.dragAssetJob;
  }

  private async getPageProxy(pageNumber: number): Promise<PDFPageProxy> {
    const record = this.pageRecords.get(pageNumber);

    if (!record || !this.pdfDocument) {
      throw new Error("Page record unavailable");
    }

    if (!record.pageProxy) {
      record.pageProxy = await this.pdfDocument.getPage(pageNumber);
    }

    return record.pageProxy;
  }

  private getDisplayWidth(shell: HTMLElement): number {
    const rawWidth = shell.clientWidth || shell.getBoundingClientRect().width || this.basePageWidth;
    const availableWidth = Math.max(320, Math.floor(rawWidth - 20));

    return Math.min(Math.floor(this.basePageWidth * this.zoomScale), availableWidth);
  }

  private async setZoom(nextZoom: number): Promise<void> {
    const clamped = Math.max(0.2, Math.min(2.5, Number(nextZoom.toFixed(2))));

    if (clamped === this.zoomScale) {
      return;
    }

    this.zoomScale = clamped;
    this.dom.pageList.style.setProperty("--zoom-scale", String(this.zoomScale));
    await this.rerenderVisiblePages();
  }

  private async fitToWidth(): Promise<void> {
    this.zoomScale = this.getFitToWidthScale();
    this.dom.pageList.style.setProperty("--zoom-scale", String(this.zoomScale));
    await this.rerenderVisiblePages();
  }

  private updateCurrentPageFromViewport(): void {
    if (!this.documentState || this.pageRecords.size === 0) {
      this.currentPage = 0;
      this.dom.currentPageInput.value = "0";
      return;
    }

    const viewerRect = this.dom.viewer.getBoundingClientRect();
    const viewerCenter = viewerRect.top + viewerRect.height / 2;
    let closestPage = this.currentPage || 1;
    let closestDistance = Number.POSITIVE_INFINITY;

    this.pageRecords.forEach((record, pageNumber) => {
      const rect = record.article.getBoundingClientRect();
      const pageCenter = rect.top + rect.height / 2;
      const distance = Math.abs(pageCenter - viewerCenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestPage = pageNumber;
      }
    });

    this.currentPage = closestPage;
    if (document.activeElement !== this.dom.currentPageInput) {
      this.dom.currentPageInput.value = String(closestPage);
    }
  }

  private commitPageJump(): void {
    const documentState = this.documentState;

    if (!documentState) {
      this.dom.currentPageInput.value = "0";
      return;
    }

    const parsed = Number.parseInt(this.dom.currentPageInput.value.trim(), 10);

    if (Number.isNaN(parsed)) {
      this.dom.currentPageInput.value = String(this.currentPage || 1);
      return;
    }

    const targetPage = Math.max(1, Math.min(documentState.pageCount, parsed));
    this.dom.currentPageInput.value = String(targetPage);
    this.scrollToPage(targetPage);
  }

  private scrollToPage(pageNumber: number): void {
    const record = this.pageRecords.get(pageNumber);

    if (!record) {
      return;
    }

    record.article.scrollIntoView({
      block: "start",
      behavior: "smooth"
    });
  }

  private showToast(message: string, tone: ToastTone = "info"): void {
    this.dom.toast.textContent = message;
    this.dom.toast.hidden = false;
    this.dom.toast.dataset.tone = tone;

    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }

    this.toastTimer = window.setTimeout(() => {
      this.dom.toast.hidden = true;
    }, 2400);
  }

  private async resetDocument(): Promise<void> {
    this.observer?.disconnect();
    this.observer = null;

    if (this.documentState) {
      await window.pdfView.clearDocumentTemp(this.documentState.fingerprint);
    }

    this.pageRecords.forEach((record) => {
      record.renderTask?.cancel();
    });

    this.pageRecords.clear();
    this.dom.pageList.replaceChildren();
    this.dom.pageList.hidden = true;
    this.dom.emptyState.hidden = false;
    this.dom.emptyState.innerHTML = this.defaultEmptyStateMarkup;

    if (this.pdfDocument) {
      await this.pdfDocument.destroy();
      this.pdfDocument = null;
    }

    this.documentState = null;
    this.currentPage = 0;
    this.zoomScale = 1;
    this.basePageWidth = DISPLAY_MAX_WIDTH;
    this.dom.currentPageInput.value = "0";
    this.dom.totalPagesText.textContent = "0";
    this.updateZoomUi();
  }

  private updateZoomUi(): void {
    this.dom.pageList.style.setProperty("--zoom-scale", String(this.zoomScale));
    this.dom.pageList.style.setProperty("--page-base-width", `${this.basePageWidth}px`);
  }

  private getFitToWidthScale(): number {
    const viewerWidth = this.dom.viewer.clientWidth || this.dom.viewer.getBoundingClientRect().width || this.basePageWidth;
    const targetWidth = Math.max(320, Math.floor(viewerWidth - 20));
    return Math.max(0.2, Math.min(1.25, Number((targetWidth / this.basePageWidth).toFixed(2))));
  }

  private shouldIgnoreShortcut(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName;
    return tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable;
  }

  private runWhenIdle<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const runner = () => {
        void task().then(resolve).catch(reject);
      };
      const idleWindow = window as IdleWindow;

      if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback(() => {
          runner();
        });
        return;
      }

      window.setTimeout(runner, 80);
    });
  }

  private escapeHtml(input: string): string {
    return input
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }
}
