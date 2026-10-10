import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/**
 * Sharing a business, as the end-to-end journeys drive it: a device with or
 * without a share sheet of its own, and a camera's reading of the QR card.
 */

const JSQR = fileURLToPath(new URL("../node_modules/jsqr/dist/jsQR.js", import.meta.url));

export const noShareSheetOnTheDevice = (page: Page) =>
  page.addInitScript(() => {
    delete (Navigator.prototype as { share?: unknown }).share;
    delete (Navigator.prototype as { canShare?: unknown }).canShare;
  });

/** A device share sheet that records what it was handed, and can be cancelled. */
export const aShareSheetOnTheDevice = (page: Page, options: { cancels?: boolean; files?: boolean } = {}) =>
  page.addInitScript(({ cancels, files }) => {
    const shared: unknown[] = [];
    (window as unknown as { __shared: unknown[] }).__shared = shared;
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        shared.push({
          title: data.title,
          text: data.text,
          url: data.url,
          files: (data.files ?? []).map((file) => ({ name: file.name, type: file.type, size: file.size })),
        });
        if (cancels) throw new DOMException("Share canceled", "AbortError");
      },
    });
    Object.defineProperty(Navigator.prototype, "canShare", {
      configurable: true,
      value: (data: ShareData) => files || (data.files ?? []).length === 0,
    });
  }, { cancels: options.cancels ?? false, files: options.files ?? false });

export const sharedOnTheDevice = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shared: { title?: string; text?: string; url?: string; files: { name: string; type: string; size: number }[] }[] }).__shared);

/** What a phone's camera would read off the card, decoded in the page. */
export const readTheCard = async (page: Page) => {
  await page.addScriptTag({ path: JSQR });
  return page.locator(".share-card img").evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const decoded = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }).jsQR(
      pixels.data,
      pixels.width,
      pixels.height,
    );
    const at = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      data: decoded?.data ?? null,
      band: at(20, 20),
      paper: at(20, Math.round(canvas.height / 2)),
    };
  });
};


/** What a camera reads off the code drawn on the screen, decoded in the page. */
export const readTheScreenCode = async (page: Page) => {
  await page.addScriptTag({ path: JSQR });
  return page.locator(".qr-on-screen").evaluate(async (svg: SVGSVGElement) => {
    const source = new XMLSerializer().serializeToString(svg);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await image.decode();
    const size = 600;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size);
    const decoded = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }).jsQR(
      pixels.data,
      size,
      size,
    );
    return decoded?.data ?? null;
  });
};
