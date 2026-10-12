// The canvases draw with the palette in index.html (:root, --name): pal.red is var(--red). No color is written in JS.
const css = getComputedStyle(document.documentElement), cache = {};
export const pal = new Proxy(cache, {
  get(c, k) {
    if (!(k in c)) { c[k] = css.getPropertyValue('--' + k).trim(); if (!c[k]) throw new Error(`--${k} is not in the palette (index.html :root)`); }
    return c[k];
  },
});
// a palette color with transparency: alpha(pal.black, .6)
export function alpha(color, a) {
  const h = color.replace('#', ''), f = h.length === 3 ? [...h].map(x => x + x) : h.match(/../g);
  return `rgba(${f.map(x => parseInt(x, 16)).join(',')},${a})`;
}
