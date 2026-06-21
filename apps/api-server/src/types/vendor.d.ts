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
  export function parseOffice(
    file: Buffer,
    callback: (err: Error | null, data?: string) => void
  ): void;
  export function parseOffice(
    file: Buffer,
    config: Record<string, unknown>,
    callback: (err: Error | null, data?: string) => void
  ): void;
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
