declare module 'adm-zip' {
  interface IZipEntry {
    entryName: string;
    getData(): Buffer;
  }

  export default class AdmZip {
    constructor(buffer?: Buffer);
    getEntries(): IZipEntry[];
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
