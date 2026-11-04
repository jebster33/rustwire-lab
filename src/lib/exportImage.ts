import { toCanvas } from 'html-to-image';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Rect } from '@xyflow/react';
import { PX_PER_M } from '../sim/engine';

const PAD = 48;
const BG = '#2a2723';
const MAX_SIDE = 14000; // browsers refuse much larger canvases

const skip = (n: HTMLElement) =>
  !(n.classList?.contains('react-flow__minimap') || n.classList?.contains('react-flow__controls') || n.classList?.contains('react-flow__resize-control'));

/** Paint the board's steel background and 1 m / 5 m grid aligned to flow coordinates. */
function paintBackground(ctx: CanvasRenderingContext2D, b: Rect, scale: number, w: number, h: number, grid: boolean) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w * 0.2, h * 0.15, 0, w * 0.2, h * 0.15, Math.max(w, h) * 0.6);
  g.addColorStop(0, 'rgba(150,84,38,0.2)');
  g.addColorStop(1, 'rgba(150,84,38,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (!grid) return;
  const ox = b.x - PAD, oy = b.y - PAD;
  for (const [step, alpha] of [[PX_PER_M, 0.035], [PX_PER_M * 5, 0.08]] as const) {
    ctx.strokeStyle = `rgba(235,228,216,${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(ox / step) * step; x < ox + w / scale; x += step) { const px = Math.round((x - ox) * scale) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
    for (let y = Math.ceil(oy / step) * step; y < oy + h / scale; y += step) { const py = Math.round((y - oy) * scale) + 0.5; ctx.moveTo(0, py); ctx.lineTo(w, py); }
    ctx.stroke();
  }
}

let fontCss: Promise<string> | null = null;
/** Google Fonts' stylesheet can't be read cross-origin, so fetch it and inline the font files ourselves. */
function embeddedFonts(): Promise<string> {
  if (fontCss) return fontCss;
  fontCss = (async () => {
    const link = document.querySelector('link[href*="fonts.googleapis.com/css"]') as HTMLLinkElement | null;
    if (!link) return '';
    try {
      let css = await (await fetch(link.href)).text();
      const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
      // only the latin subsets the UI uses, to keep it quick
      const wanted = urls.filter((u) => css.split(u)[0].lastIndexOf('/* latin */') > css.split(u)[0].lastIndexOf('}') - 400 || urls.length < 12);
      await Promise.all(wanted.map(async (u) => {
        const blob = await (await fetch(u)).blob();
        const data = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(blob); });
        css = css.split(u).join(data);
      }));
      return css;
    } catch {
      return '';
    }
  })();
  return fontCss;
}

/** Render the whole layout (not just what's on screen) to a canvas. */
export async function renderBoard(bounds: Rect, wantScale: number, grid = true): Promise<HTMLCanvasElement> {
  const el = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!el) throw new Error('The board isn’t ready yet.');
  const width = Math.ceil(bounds.width + PAD * 2);
  const height = Math.ceil(bounds.height + PAD * 2);
  const scale = Math.max(0.25, Math.min(wantScale, MAX_SIDE / width, MAX_SIDE / height));
  const fontEmbedCSS = await embeddedFonts();
  const shot = await toCanvas(el, {
    width, height, pixelRatio: scale, filter: skip, cacheBust: false, fontEmbedCSS, skipFonts: !fontEmbedCSS,
    style: { width: `${width}px`, height: `${height}px`, transform: `translate(${-bounds.x + PAD}px, ${-bounds.y + PAD}px) scale(1)` },
  });
  const out = document.createElement('canvas');
  out.width = shot.width;
  out.height = shot.height;
  const ctx = out.getContext('2d')!;
  paintBackground(ctx, bounds, scale, out.width, out.height, grid);
  ctx.drawImage(shot, 0, 0);
  return out;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function exportPng(bounds: Rect, scale: number, grid: boolean, name: string) {
  const c = await renderBoard(bounds, scale, grid);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('This build is too big to export as one image. Try a lower resolution.');
  download(blob, `${name}.png`);
  return { w: c.width, h: c.height };
}

/** Record the running simulation as an animated GIF. */
export async function exportGif(bounds: Rect, opts: { seconds: number; fps: number; maxSide: number; grid: boolean; name: string; onProgress?: (f: number) => void }) {
  const frames = Math.max(2, Math.round(opts.seconds * opts.fps));
  const width = bounds.width + PAD * 2, height = bounds.height + PAD * 2;
  const scale = Math.min(2, opts.maxSide / Math.max(width, height));
  const gif = GIFEncoder();
  const delay = Math.round(1000 / opts.fps);
  let w = 0, h = 0;
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    const c = await renderBoard(bounds, scale, opts.grid);
    w = c.width; h = c.height;
    const data = c.getContext('2d')!.getImageData(0, 0, w, h).data;
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay });
    opts.onProgress?.((i + 1) / frames);
    const wait = delay - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  gif.finish();
  download(new Blob([gif.bytes()], { type: 'image/gif' }), `${opts.name}.gif`);
  return { w, h, frames };
}
