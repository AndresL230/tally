// Rule 8: the client downscales receipt photos before upload — max edge
// 1500px (never upscaled), re-encoded as JPEG at quality 0.85. A failed
// downscale must not block adding a receipt: fall back to the original
// bytes (logged) and let the server take it from there.
//
// A receipt can also arrive as a PDF (emailed or downloaded rather than
// photographed). There is nothing to downscale there — those bytes go up
// exactly as picked, and the server sends them to the model as a document.

const MAX_EDGE = 1500;
const JPEG_QUALITY = 0.85;

export const PDF_TYPE = "application/pdf";

/** What the file pickers accept, and what a drop is judged against. */
export const RECEIPT_ACCEPT = `image/*,${PDF_TYPE}`;

/** What a picked file goes up as. Some pickers hand over a PDF with an
 *  empty `type`, and the name is then the only clue; anything else keeps
 *  the server's own default. */
export function receiptTypeOf(file: File): string {
  if (file.type) return file.type;
  return file.name.toLowerCase().endsWith(".pdf") ? PDF_TYPE : "";
}

export function isReceiptFile(file: File): boolean {
  return file.type.startsWith("image/") || receiptTypeOf(file) === PDF_TYPE;
}

export async function downscaleImage(file: File | Blob): Promise<Blob> {
  // A PDF has nothing to downscale; it goes up byte for byte.
  if (file.type === PDF_TYPE) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    console.warn("downscaleImage: decode failed, uploading original bytes", err);
    return file;
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height)); // never upscale
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) throw new Error("canvas.toBlob returned null");
    return blob;
  } catch (err) {
    console.warn("downscaleImage: re-encode failed, uploading original bytes", err);
    return file;
  } finally {
    bitmap.close();
  }
}
