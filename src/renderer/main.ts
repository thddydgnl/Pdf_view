import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

import { PdfViewerApp } from "./lib/pdf-viewer-app";
import "./styles/main.css";

GlobalWorkerOptions.workerSrc = workerUrl;

const app = new PdfViewerApp();
void app.mount();
