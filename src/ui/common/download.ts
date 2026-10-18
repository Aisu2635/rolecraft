/**
 * Saves `data` as a file through a temporary `<a download>`. Strings are written as given (a `.sh` file keeps its
 * LF line endings). The object URL is released after the click has been processed, not during it.
 */
export function downloadFile(filename: string, data: string | Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
