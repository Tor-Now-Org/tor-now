/**
 * Preparing a photo for upload.
 *
 * A phone camera produces four thousand pixels and eight megabytes for a
 * picture that is shown three hundred pixels wide. Sending that would be slow
 * to upload, slow for every customer to load, and past the size the API accepts
 * — a limit somebody would discover by being refused, with nothing they could
 * usefully do about it. So every file is re-encoded before it leaves the
 * browser, in the one place both the wizard and the settings screen use.
 */

/** Wide enough for a cover on a large screen, and no wider. */
const LONGEST_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export const shrinkForUpload = async (file: File): Promise<Blob> => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONGEST_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encoded = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  // A browser that will not encode is not a reason to lose the photo: the
  // original is either within the limit or the API will say so.
  return encoded ?? file;
};
