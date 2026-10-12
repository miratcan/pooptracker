// A bug walks around the page. Click it to report one [ZEN-JUST-PLAY].
// Now and then it stops and talks: a tip about the app, and every third time it asks for bug reports.
// It isn't part of the output video (it lives outside the canvas).
const ISSUE_URL = 'https://github.com/miratcan/pooptracker/issues/new';
const ASK = ['Do you see a bug?', 'Click me to create an issue'];
const TIPS = [
  'Esc turns edit mode on and off. Off: the keys just play. On: they write.',
  'Enter plays the song from the pattern you are on.',
  'Drop a video anywhere on the page to make an instrument.',
  'A higher note plays the video faster too: 12 semitones up = twice as fast.',
  'Put the hit point where the sound kicks in: every note lands exactly on it.',
  'Shift+Enter inserts a row, Shift+Backspace pulls the rows below up.',
  'Sxx shakes or zooms the video, Ixx inverts its colors.',
  'Ctrl/⌘+Z undoes anything. Go wild.',
  'Tab jumps to the next channel.',
  '"Save to video" keeps an instrument inside its own MP4. Share it!',
];
const SIZE = 26, SPEED = 38; // px, px per second

const css = document.createElement('style');
css.textContent = `
#bug{position:fixed;left:0;top:0;width:${SIZE}px;height:${SIZE}px;z-index:30;cursor:pointer;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
#bug svg{display:block;width:100%;height:100%}
#bug .legs path{animation:bugLegs .18s linear infinite alternate;transform-origin:50% 55%}
#bug .legs path:nth-child(even){animation-direction:alternate-reverse}
#bug.still .legs path{animation:none}
@keyframes bugLegs{from{transform:rotate(-9deg)}to{transform:rotate(9deg)}}
#bugSay{position:fixed;z-index:31;pointer-events:none;background:#fff;color:#111;font:12px/1.3 ui-monospace,Menlo,monospace;padding:5px 9px;border-radius:10px;width:max-content;max-width:min(260px,calc(100vw - 16px));box-shadow:0 2px 8px rgba(0,0,0,.5);opacity:0;transition:opacity .2s}
#bugSay.on{opacity:1}
#bugSay::after{content:'';position:absolute;left:14px;bottom:-6px;border:6px solid transparent;border-top-color:#fff;border-bottom:0}`;
document.head.appendChild(css);

const bug = document.createElement('div');
bug.id = 'bug'; bug.title = 'Found a bug? Click me to report it on GitHub'; bug.setAttribute('role', 'link'); bug.setAttribute('aria-label', 'Report a bug on GitHub');
// a beetle, head up (heading 0 = up); the legs wiggle while it walks
bug.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <g class="legs" stroke="#2b1a10" stroke-width="1.6" stroke-linecap="round" fill="none">
    <path d="M10 12 L4 9"/><path d="M22 12 L28 9"/><path d="M9 17 L3 17"/><path d="M23 17 L29 17"/><path d="M10 22 L4 26"/><path d="M22 22 L28 26"/>
  </g>
  <path d="M13 6 L11 2 M19 6 L21 2" stroke="#2b1a10" stroke-width="1.4" stroke-linecap="round"/>
  <circle cx="16" cy="8" r="4" fill="#2b1a10"/>
  <ellipse cx="16" cy="18" rx="8" ry="10" fill="#e0402b"/>
  <path d="M16 8.5 V28" stroke="#2b1a10" stroke-width="1.2"/>
  <circle cx="12.5" cy="15" r="1.8" fill="#2b1a10"/><circle cx="19.5" cy="15" r="1.8" fill="#2b1a10"/>
  <circle cx="12" cy="22" r="1.6" fill="#2b1a10"/><circle cx="20" cy="22" r="1.6" fill="#2b1a10"/>
</svg>`;
const say = document.createElement('div');
say.id = 'bugSay';
document.body.append(bug, say);
bug.addEventListener('click', () => window.open(ISSUE_URL, '_blank', 'noopener'));

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
let x = innerWidth * 0.3, y = innerHeight * 0.4, heading = Math.random() * Math.PI * 2, turn = 0;
let talkUntil = 0, nextTalk = performance.now() + 12000 + Math.random() * 15000, last = performance.now();

function place() {
  bug.style.transform = `translate(${x - SIZE / 2}px, ${y - SIZE / 2}px) rotate(${heading}rad)`;
  // the bubble stays inside the window
  say.style.left = `${Math.max(8, Math.min(innerWidth - say.offsetWidth - 8, x - 16))}px`; say.style.top = `${Math.max(8, y - SIZE / 2 - say.offsetHeight - 10)}px`;
}
// stop, say the lines one after the other (long ones stay longer), walk on; the tips come in turn
let talks = 0, tip = Math.floor(Math.random() * TIPS.length);
function talk(now) {
  const lines = ++talks % 3 === 0 ? ASK : [TIPS[tip++ % TIPS.length]];
  bug.classList.add('still');
  let at = 0;
  for (const line of lines) {
    const show = 1800 + line.length * 45;
    setTimeout(() => { say.textContent = line; place(); say.classList.add('on'); }, at);
    setTimeout(() => say.classList.remove('on'), at + show);
    at += show + 400;
  }
  talkUntil = now + at;
  nextTalk = now + at + 20000 + Math.random() * 25000;
}
function step(now) {
  requestAnimationFrame(step);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (now < talkUntil) return;
  if (now >= nextTalk) { talk(now); return; }
  bug.classList.remove('still');
  // wander: the turning rate drifts, so the path curves and meanders instead of jittering
  turn = Math.max(-2, Math.min(2, turn + (Math.random() - 0.5) * 6 * dt));
  heading += turn * dt;
  x += Math.sin(heading) * SPEED * dt; y -= Math.cos(heading) * SPEED * dt;
  // turn back from the edges of the window
  const m = SIZE;
  if (x < m || x > innerWidth - m || y < m || y > innerHeight - m) {
    x = Math.max(m, Math.min(innerWidth - m, x)); y = Math.max(m, Math.min(innerHeight - m, y));
    heading = Math.atan2(innerWidth / 2 - x, -(innerHeight / 2 - y)) + (Math.random() - 0.5);
    turn = 0;
  }
  place();
}
if (still) { x = innerWidth - 40; y = innerHeight - 50; bug.classList.add('still'); place(); }
else requestAnimationFrame(step);
