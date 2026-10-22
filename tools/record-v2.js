// Aviationary daily video, v2 ("quiz" format, built for Reels retention).
//  - Opens straight on a word with a hook question (no title screen)
//  - Each word: hook text + 3-2-1 countdown with ticks, THEN the Star answer is typed
//  - Only the 3 hardest words are shown (~20 s); the rest are played but cut out
//  - No spoiler banner; spoiler-free caption that asks for comments
//  - Real game sound effects (captured from the game's Web Audio) + countdown ticks
//  - Full 9:16 frame, big text kept inside Instagram's safe zones
//  - Ends on a "Can you beat it?" card that cross-fades into the first frame (loops)
// Usage: node record-v2.js --site <game site folder> --out <output folder> [YYYY-MM-DD] [--keep 3] [--count 3]
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const SITE = path.resolve(opt("--site", path.join(__dirname, "site")));
const OUT = path.resolve(opt("--out", path.join(__dirname, "out")));
const KEEP = Number(opt("--keep", 3));
const COUNT = Number(opt("--count", 3));   // countdown length in seconds before each answer
fs.mkdirSync(OUT, { recursive: true });

function yesterdayNY() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
const day = args[0] || yesterdayNY();
const [Y, M, D] = day.split("-").map(Number);
const prettyDate = new Date(Y, M - 1, D).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const W = 540, H = 960;   // 9:16, scaled 2x later -> 1080x1920
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Overlay (injected into the page) ----------
const OVERLAY_CSS = `
#game .keyboard, #keyboard { display:none !important; }
#game .stage { transform: scale(1.12); transform-origin: 50% 40%; }
#game #hint { visibility:hidden; }
#results .stats, #results .countdown, #results h3.section-title:has(+ .stats){display:none!important}
#vo { position:fixed; inset:0; z-index:9999; pointer-events:none; font-family: system-ui, "Nunito", "Segoe UI", sans-serif; }
#vo .hook { position:absolute; left:28px; right:28px; top:118px; text-align:center; color:#fff;
  background:rgba(20,40,80,.88); border-radius:22px; padding:14px 16px 16px; box-shadow:0 8px 24px rgba(0,0,0,.25);
  transform:scale(.6); opacity:0; transition:transform .25s cubic-bezier(.2,1.6,.4,1), opacity .2s; }
#vo .hook.on { transform:scale(1); opacity:1; }
#vo .hook .big { font-size:31px; font-weight:900; line-height:1.15; letter-spacing:.2px; }
#vo .hook .small { font-size:20px; font-weight:800; color:#ffd36b; margin-top:6px; }
#vo .count { position:absolute; left:50%; top:640px; width:120px; height:120px; margin-left:-60px; border-radius:50%;
  background:#ff7a2f; color:#fff; font-size:72px; font-weight:900; display:flex; align-items:center; justify-content:center;
  box-shadow:0 6px 0 #c8551a, 0 10px 24px rgba(0,0,0,.25); opacity:0; }
#vo .count.pop { animation: vopop .9s ease-out forwards; }
@keyframes vopop { 0%{transform:scale(1.6);opacity:0} 15%{transform:scale(1);opacity:1} 80%{opacity:1} 100%{transform:scale(.85);opacity:0} }
#vo .end { position:absolute; inset:0; background:linear-gradient(#1d3b6a, #2d6bb3); color:#fff; text-align:center;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; opacity:0; transition:opacity .35s; padding:0 30px 230px; }
#vo .end.on { opacity:1; }
#vo .end .alt { font-size:84px; font-weight:900; line-height:1; }
#vo .end .stars { font-size:40px; letter-spacing:2px; }
#vo .end .q { font-size:46px; font-weight:900; margin-top:18px; line-height:1.1; }
#vo .end .c { font-size:28px; font-weight:800; color:#ffd36b; }
#vo .end .url { font-size:22px; font-weight:700; opacity:.9; margin-top:22px; background:rgba(255,255,255,.15); padding:8px 18px; border-radius:999px; }
#vo .end .lbl { font-size:22px; font-weight:800; opacity:.85; letter-spacing:1px; text-transform:uppercase; }
`;

(async () => {
  await new Promise((r) => server.listen(8765, r));
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  await context.clock.install({ time: new Date(Y, M - 1, D, 12, 0, 0) });
  await context.addInitScript(() => {
    try { localStorage.setItem("aviationary-seen-help", "1"); localStorage.setItem("aviationary-muted", "0"); } catch {}
    // Tap the game's Web Audio output so we can record it.
    const Orig = window.AudioContext;
    window.AudioContext = class extends Orig {
      constructor(...a) {
        super(...a);
        const tap = this.createGain();
        tap.connect(super.destination);
        const rec = this.createMediaStreamDestination();
        tap.connect(rec);
        Object.defineProperty(this, "destination", { get: () => tap });
        window.__actx = this; window.__tap = tap; window.__stream = rec.stream;
      }
    };
    window.webkitAudioContext = window.AudioContext;
  });
  await context.route(/supabase\.co/, (r) => r.abort());

  const tVideo0 = Date.now();
  const page = await context.newPage();
  await page.goto("http://localhost:8765/?practice");
  await page.waitForSelector("#takeoff");
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    const vo = document.createElement("div");
    vo.id = "vo";
    vo.innerHTML = `<div class="hook"><div class="big"></div><div class="small"></div></div><div class="count"></div><div class="end"></div>`;
    document.body.append(vo);
    const strip = () => { for (const id of ["puzzle-no", "results-no"]) { const el = document.getElementById(id); if (el && el.textContent.includes(" (practice)")) el.textContent = el.textContent.replace(" (practice)", ""); } };
    new MutationObserver(strip).observe(document.body, { childList: true, characterData: true, subtree: true });
    strip();
    window.__vo = {
      hook(big, small) { const h = vo.querySelector(".hook"); h.querySelector(".big").textContent = big; h.querySelector(".small").textContent = small || ""; h.classList.remove("on"); void h.offsetWidth; h.classList.add("on"); },
      hideHook() { vo.querySelector(".hook").classList.remove("on"); },
      count(n) { const c = vo.querySelector(".count"); c.textContent = n; c.classList.remove("pop"); void c.offsetWidth; c.classList.add("pop"); },
      end(html) { const e = vo.querySelector(".end"); e.innerHTML = html; e.classList.add("on"); },
      whoosh() {   // short airy whoosh for cuts
        const ctx = window.__actx; if (!ctx) return;
        const t = ctx.currentTime, dur = 0.35;
        const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = buf; f.type = "bandpass"; f.Q.value = 1.2;
        f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3500, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f).connect(g).connect(window.__tap); s.start(t); s.stop(t + dur + 0.05);
      },
    };
  });

  const info = await page.evaluate(() => {
    const n = Aviationary.puzzleNumber();
    return { n, words: Aviationary.cluesFor(n).map((clue) => {
      const groups = WORDS.syn[clue].split("|");
      return { clue, best: groups[groups.length - 1].split(" ").filter(Boolean)[0] };
    }) };
  });
  const puzzle = info.n, words = info.words;
  // The hardest-looking words (longest Star answers), kept in game order.
  const keep = new Set([...words.keys()].sort((a, b) => words[b].best.length - words[a].best.length || a - b).slice(0, KEEP));
  console.log(`Puzzle #${puzzle} (${day}):`, words.map((w, i) => `${keep.has(i) ? "*" : ""}${w.clue} -> ${w.best}`).join(", "));

  const now = () => (Date.now() - tVideo0) / 1000;  // seconds on the raw video timeline
  const segs = [];

  // Edit marker: a thin strip along the bottom edge, white while a part we keep is on
  // screen. ffmpeg finds those frames in the raw video, then the strip is cropped off.
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:8px;background:#000;z-index:99999";
    document.body.append(d);
    window.__mark = (on) => { d.style.background = on ? "#fff" : "#000"; };
  });

  // Take off (off camera: it's cut), then start recording audio.
  await page.click("#takeoff");
  const audioT0 = await page.evaluate(async () => {
    const rec = new MediaRecorder(window.__stream, { mimeType: "audio/webm;codecs=opus" });
    window.__chunks = [];
    rec.ondataavailable = (e) => e.data.size && window.__chunks.push(e.data);
    window.__rec = rec;
    await new Promise((r) => { rec.onstart = r; rec.start(250); });
    return Date.now();   // faked page clock; we use node time below
  }).then(() => now());
  await wait(1600);

  let first = true;
  for (let i = 0; i < words.length; i++) {
    const { clue, best } = words[i];
    if (!keep.has(i)) {
      await page.keyboard.type(best, { delay: 15 });
      await page.keyboard.press("Enter");
      await wait(400);
      await page.click("#next");
      await wait(700);
      continue;
    }
    await wait(250);
    await page.evaluate(([f, n]) => {
      window.__vo.hook(f ? "Can you find the ⭐ synonym?" : "Find the ⭐ synonym", f ? `Only ONE answer earns the star · ${n} letters` : `Hint: ${n} letters · beat the countdown`);
      if (!f) window.__vo.whoosh();
    }, [first, best.length]);
    await wait(120);
    await page.evaluate(() => window.__mark(true));
    const s = now();   // start once the hook is on screen
    await wait(first ? 650 : 150);
    for (let n = COUNT; n >= 1; n--) {
      await page.evaluate((n) => { window.__vo.count(n); AviationarySound.tick(n === 1); }, n);
      await wait(n === 1 ? 750 : 800);
    }
    await page.evaluate(() => window.__vo.hideHook());
    await page.keyboard.type(best, { delay: 40 });
    await wait(200);
    await page.keyboard.press("Enter");
    await wait(2100);                       // Star animation + chime
    await page.evaluate(() => window.__mark(false));
    segs.push([s, now()]);
    await page.click("#next");
    await wait(700);
    first = false;
  }

  // Results -> end card
  await page.waitForSelector("#results:not(.hidden)", { timeout: 10000 });
  await wait(300);
  const alt = await page.evaluate(() => document.getElementById("final-altitude").textContent);
  await page.evaluate(([alt, no]) => {
    window.__vo.whoosh();
    window.__vo.end(`<div class="lbl">Aviationary #${no} · all 7 Stars</div><div class="alt">${alt}</div><div class="stars">⭐⭐⭐⭐⭐⭐⭐</div>
      <div class="q">Can you beat it?</div><div class="c">Comment your altitude 👇</div><div class="url">Play free · aviationary.netlify.app</div>`);
  }, [alt, puzzle]);
  await wait(400);   // let the card fade in
  await page.evaluate(() => { window.__mark(true); AviationarySound.ding(6); });
  const s = now();
  await wait(3000);
  await page.evaluate(() => window.__mark(false));
  segs.push([s, now()]);
  await wait(300);

  const audioB64 = await page.evaluate(async () => {
    const rec = window.__rec;
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    const blob = new Blob(window.__chunks, { type: "audio/webm" });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const video = page.video();
  await context.close();
  await browser.close();
  server.close();
  const raw = await video.path();
  const rawAudio = path.join(OUT, `raw-audio-${day}.webm`);
  fs.writeFileSync(rawAudio, Buffer.from(audioB64, "base64"));

  // ---------- Edit: keep segments, add audio, loop cross-fade to first frame ----------
  // Find the marked (kept) stretches of the raw video.
  const stats = require("child_process").spawnSync("ffmpeg", ["-hide_banner", "-i", raw, "-vf",
    `crop=${W}:4:0:${H - 4},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout;
  const vsegs = [];
  let t = null, on = false, seenBlack = false, startT = 0, lastT = 0;
  for (const line of stats.split("\n")) {
    const pm = /pts_time:([\d.]+)/.exec(line);
    if (pm) { t = Number(pm[1]); continue; }
    const ym = /YAVG=([\d.]+)/.exec(line);
    if (ym && t !== null) {
      const white = Number(ym[1]) > 128;
      if (!white) seenBlack = true;
      if (!seenBlack) continue;          // blank page before the marker strip exists
      if (white && !on) { on = true; startT = t; }
      if (!white && on) { on = false; vsegs.push([startT, t]); }
      lastT = t;
    }
  }
  if (on) vsegs.push([startT, lastT]);
  // Smooth out encoder blips: join parts split by a tiny gap, drop tiny stray parts.
  const merged = [];
  for (const p of vsegs) {
    const prev = merged[merged.length - 1];
    if (prev && p[0] - prev[1] < 0.35) prev[1] = p[1]; else merged.push([...p]);
  }
  const rawParts = vsegs.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(" ");
  vsegs.length = 0;
  vsegs.push(...merged.filter(([a, b]) => b - a > 0.5));
  if (vsegs.length !== segs.length) throw new Error(`found ${vsegs.length} marked parts in the video, expected ${segs.length} (raw: ${rawParts})`);
  console.log("Video parts:", vsegs.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(" "));
  const final = path.join(OUT, `aviationary-${day}-v2.mp4`);
  const firstFrame = path.join(OUT, `first-${day}.png`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(vsegs[0][0] + 0.04), "-i", raw, "-frames:v", "1", "-vf", `crop=${W}:${H - 8}:0:0`, firstFrame]);
  const parts = [];
  segs.forEach(([a, b], k) => {
    const [va, vb] = vsegs[k], stretch = (b - a) / (vb - va);   // match the real-time audio length
    parts.push(`[0:v]trim=${va.toFixed(3)}:${vb.toFixed(3)},setpts=(PTS-STARTPTS)*${stretch.toFixed(5)},crop=${W}:${H - 8}:0:0,scale=1080:1920:flags=lanczos,fps=30,format=yuv420p,setsar=1,settb=1/30[v${k}]`);
    const aa = Math.max(0, a - audioT0), bb = b - audioT0;
    parts.push(`[1:a]atrim=${aa.toFixed(3)}:${bb.toFixed(3)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${k}]`);
  });
  const total = segs.reduce((t, [a, b]) => t + (b - a), 0);
  const fade = 0.45;
  parts.push(segs.map((_, k) => `[v${k}][a${k}]`).join("") + `concat=n=${segs.length}:v=1:a=1[cv][ca]`);
  parts.push(`[2:v]scale=1080:1920,fps=30,format=yuv420p,setsar=1,settb=1/30[still]`);
  parts.push(`[cv]settb=1/30[cv2]`);
  parts.push(`[cv2][still]xfade=transition=fade:duration=${fade}:offset=${(total - 0.05).toFixed(3)}[vout]`);
  parts.push(`[ca]volume=7,alimiter=limit=0.89,apad,atrim=0:${(total + fade - 0.05).toFixed(3)},afade=t=out:st=${(total - 0.3).toFixed(3)}:d=${(fade + 0.25).toFixed(3)}[aout]`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-i", rawAudio, "-loop", "1", "-framerate", "30", "-t", "2", "-i", firstFrame,
    "-filter_complex", parts.join(";"), "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "19", "-r", "30",
    "-c:a", "aac", "-b:a", "160k", "-t", (total + fade - 0.05).toFixed(3), "-movflags", "+faststart", final]);
  fs.unlinkSync(raw); fs.unlinkSync(rawAudio); fs.unlinkSync(firstFrame);

  fs.writeFileSync(path.join(OUT, `aviationary-${day}-v2-caption.txt`),
    `Only one synonym per word earns the ⭐ Did you get them? ✈️\n\n` +
    `Aviationary #${puzzle} · ${prettyDate}. We hit ${alt} with all 7 Stars. How high did you fly? Comment your altitude 👇\n\n` +
    `New puzzle every day, free: aviationary.netlify.app\n#aviationary #wordgame #dailypuzzle #synonyms #wordle #wordpuzzle #brainteaser`);
  console.log("Segments:", segs.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(" "), "total", total.toFixed(2));
  console.log("Done:", final);
})().catch((e) => { console.error(e); process.exit(1); });
