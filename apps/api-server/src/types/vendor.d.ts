declare module 'adm-zip' {
  interface IZipEntry {
    entryName: string;
    /** The central-directory header. `size` is the DECLARED uncompressed size — attacker-controlled, so check it before `getData()`. */
    header: { size: number; compressedSize: number };
    getData(): Buffer;
  }

  export default class AdmZip {
    constructor(buffer?: Buffer);
    getEntries(): IZipEntry[];
    /** Write side — used to build Office fixtures (a .docx is a ZIP of XML). */
    addFile(entryName: string, content: Buffer): void;
    toBuffer(): Buffer;
  }
}

declare module 'sql.js' {
  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface Database {
    exec(sql: string): QueryExecResult[];
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}

declare module 'pdf-parse' {
  function pdfParse(data: Buffer): Promise<{ text: string; numpages: number }>;
  export = pdfParse;
}

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(src: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (p: { scale: number }) => { width: number; height: number };
        render: (p: Record<string, unknown>) => { promise: Promise<void> };
      }>;
      destroy?: () => Promise<void> | void;
    }>;
  };
}

declare module '@napi-rs/canvas' {
  export function createCanvas(
    width: number,
    height: number
  ): {
    width: number;
    height: number;
    getContext: (type: '2d') => unknown;
    toBuffer: (mime?: string) => Buffer;
  };
}

declare module 'tesseract.js' {
  export function createWorker(
    langs?: string,
    oem?: number,
    options?: Record<string, unknown>
  ): Promise<{
    recognize: (image: Buffer | string) => Promise<{ data: { text: string } }>;
    terminate: () => Promise<void>;
  }>;
}

declare module 'officeparser' {
  export interface OfficeParserAst {
    toText(): string;
    to(format: 'text' | 'md' | 'html' | string, options?: Record<string, unknown>): Promise<{
      value: string | Uint8Array;
      messages?: unknown[];
    }>;
    metadata?: { pages?: number; slides?: number; [key: string]: unknown };
    attachments?: Array<{ ocrText?: string; name?: string }>;
  }

  export interface OfficeParserConfig {
    extractAttachments?: boolean;
    ocr?: boolean;
    ocrLanguage?: string;
    ocrConfig?: {
      language?: string;
      timeout?: {
        workerLoad?: number;
        recognition?: number;
        autoTerminate?: number;
      };
      [key: string]: unknown;
    };
    abortSignal?: AbortSignal | null;
    [key: string]: unknown;
  }

  export function parseOffice(
    file: Buffer | string,
    config?: OfficeParserConfig
  ): Promise<OfficeParserAst>;

  export function terminateOcr(): Promise<void>;
}

declare module 'libreoffice-convert' {
  function convert(
    document: Buffer,
    format: string,
    filter: undefined,
    callback: (err: Error | null, done: Buffer) => void
  ): void;
  export { convert };
  export default { convert };
}
