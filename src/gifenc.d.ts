declare module 'gifenc' {
  type Palette = number[][];
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: Palette; delay?: number; transparent?: boolean; repeat?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(rgba: Uint8ClampedArray | Uint8Array, maxColors: number, opts?: Record<string, unknown>): Palette;
  export function applyPalette(rgba: Uint8ClampedArray | Uint8Array, palette: Palette, format?: string): Uint8Array;
}
