// Bundled web fonts (work offline and render identically in preview and export).
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";
import "@fontsource/montserrat/900-italic.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource/poppins/900.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/700.css";
import "@fontsource/roboto/900.css";
import "@fontsource/anton/400.css";
import "@fontsource/bangers/400.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/luckiest-guy/400.css";
import "@fontsource/archivo-black/400.css";
import "@fontsource/permanent-marker/400.css";

export interface FontDef { family: string; weights: number[]; group: "Bundled" | "System" | "Installed" }

export const FONTS: FontDef[] = [
  { family: "Montserrat", weights: [400, 600, 700, 800, 900], group: "Bundled" },
  { family: "Poppins", weights: [400, 600, 700, 800, 900], group: "Bundled" },
  { family: "Inter", weights: [400, 500, 600, 700, 800, 900], group: "Bundled" },
  { family: "Roboto", weights: [400, 700, 900], group: "Bundled" },
  { family: "Anton", weights: [400], group: "Bundled" },
  { family: "Bangers", weights: [400], group: "Bundled" },
  { family: "Bebas Neue", weights: [400], group: "Bundled" },
  { family: "Luckiest Guy", weights: [400], group: "Bundled" },
  { family: "Archivo Black", weights: [400], group: "Bundled" },
  { family: "Permanent Marker", weights: [400], group: "Bundled" },
  { family: "Arial", weights: [400, 700], group: "System" },
  { family: "Arial Black", weights: [900], group: "System" },
  { family: "Impact", weights: [400], group: "System" },
  { family: "Segoe UI", weights: [400, 600, 700, 900], group: "System" },
  { family: "Verdana", weights: [400, 700], group: "System" },
  { family: "Trebuchet MS", weights: [400, 700], group: "System" },
  { family: "Comic Sans MS", weights: [400, 700], group: "System" },
  { family: "Georgia", weights: [400, 700], group: "System" },
];

/** Chromium's Local Font Access API — lets users pick any installed font. */
export async function loadInstalledFonts(): Promise<string[]> {
  const q = (window as any).queryLocalFonts;
  if (!q) throw new Error("Your browser doesn't support listing installed fonts (use Edge or Chrome).");
  const fonts: any[] = await q();
  const fams = Array.from(new Set(fonts.map((f) => f.family as string))).sort();
  for (const fam of fams) if (!FONTS.some((f) => f.family === fam)) FONTS.push({ family: fam, weights: [400, 700], group: "Installed" });
  return fams;
}

export function fontString(style: { italic: boolean; fontWeight: number; fontFamily: string }, px: number) {
  return `${style.italic ? "italic " : ""}${style.fontWeight} ${px}px "${style.fontFamily}", "Arial", sans-serif`;
}

export async function ensureFontsLoaded(styles: { italic: boolean; fontWeight: number; fontFamily: string }[]) {
  await Promise.all(styles.map((s) => document.fonts.load(fontString(s, 64), "AaBbYy09!?").catch(() => null)));
}
