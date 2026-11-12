// The share card, drawn on the server so an assistant can put the picture straight into the chat. Same drawing code as
// the phone (card-client.js), on a server-side canvas with Clue's own fonts.
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { render, postText, useEnvironment } from './card-client.js';

const pub = (f) => fileURLToPath(new URL('./public/' + f, import.meta.url));
GlobalFonts.registerFromPath(pub('fonts/geist-latin-wght-normal.woff2'), 'Geist');
GlobalFonts.registerFromPath(pub('fonts/geist-mono-latin-wght-normal.woff2'), 'Geist Mono');
useEnvironment({ canvas: (w, h) => createCanvas(w, h), image: (src) => loadImage(src.startsWith('/') ? pub(src.slice(1)) : src), fonts: false });

export async function cardPng(d) { const c = await render(d); return c.toBuffer('image/png'); }
export { postText };
