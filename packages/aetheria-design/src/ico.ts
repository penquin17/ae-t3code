const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

export interface IcoImage {
  /** Edge length in pixels; the PNG must be a square of exactly this size. */
  readonly size: number;
  readonly png: Uint8Array;
}

export interface IcoEntry {
  readonly size: number;
  readonly offset: number;
  readonly length: number;
}

/** Width and height from a PNG's IHDR chunk. */
export function readPngSize(png: Uint8Array): { readonly width: number; readonly height: number } {
  if (png.length < 24 || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) {
    throw new Error("not a PNG: the signature is missing");
  }
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (view.getUint32(12) !== 0x49484452) throw new Error("not a PNG: IHDR is not the first chunk");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** An .ico file whose images are the given PNG payloads, in the order given. */
export function encodeIco(images: readonly IcoImage[]): Uint8Array {
  if (images.length === 0) throw new Error("an icon needs at least one image");
  for (const image of images) {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256) {
      throw new Error(`an icon image is 1 to 256 pixels wide, not ${image.size}`);
    }
    const { width, height } = readPngSize(image.png);
    if (width !== image.size || height !== image.size) {
      throw new Error(`a ${image.size}px icon entry holds a ${width}x${height} PNG`);
    }
  }
  const dataStart = HEADER_BYTES + ENTRY_BYTES * images.length;
  const total = images.reduce((sum, image) => sum + image.png.length, dataStart);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = dataStart;
  images.forEach((image, index) => {
    const entry = HEADER_BYTES + ENTRY_BYTES * index;
    // A width or height of 256 is written as 0.
    view.setUint8(entry, image.size === 256 ? 0 : image.size);
    view.setUint8(entry + 1, image.size === 256 ? 0 : image.size);
    view.setUint8(entry + 2, 0);
    view.setUint8(entry + 3, 0);
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, image.png.length, true);
    view.setUint32(entry + 12, offset, true);
    bytes.set(image.png, offset);
    offset += image.png.length;
  });
  return bytes;
}

/** The directory of an .ico file, checked against the file's own length. */
export function readIco(bytes: Uint8Array): readonly IcoEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < HEADER_BYTES ||
    view.getUint16(0, true) !== 0 ||
    view.getUint16(2, true) !== 1
  ) {
    throw new Error("not an .ico file");
  }
  const count = view.getUint16(4, true);
  const entries: IcoEntry[] = [];
  for (let index = 0; index < count; index++) {
    const entry = HEADER_BYTES + ENTRY_BYTES * index;
    if (entry + ENTRY_BYTES > bytes.length)
      throw new Error("the icon directory runs past the file");
    const width = view.getUint8(entry) || 256;
    const length = view.getUint32(entry + 8, true);
    const offset = view.getUint32(entry + 12, true);
    if (offset + length > bytes.length) throw new Error(`icon entry ${index} runs past the file`);
    entries.push({ size: width, offset, length });
  }
  return entries;
}
