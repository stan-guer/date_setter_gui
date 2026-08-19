// Type declaration for the vendored JSZip UMD bundle (jszip.min.js).
// It is loaded via <script> so it is available as a global in the browser,
// not as an ES module import.
interface JSZipInstance {
  file(name: string, data: Blob | Uint8Array | string): JSZipInstance;
  generateAsync(options: { type: "blob"; compression?: "STORE" | "DEFLATE" }): Promise<Blob>;
}

declare const JSZip: new () => JSZipInstance;
