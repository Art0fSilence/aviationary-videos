// Aviationary daily video: plays YESTERDAY's puzzle, typing the best (Star)
// answer for each word, and records it. Then ffmpeg adds a caption banner.
// Usage: node record.js --site <game site folder> --out <output folder> [YYYY-MM-DD]
//   (date defaults to yesterday, New York time)
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? path.resolve(args.splice(i, 2)[1]) : fallback; };
const SITE = opt("--site", path.join(__dirname, "site"));
const OUT = opt("--out", path.join(__dirname, "out"));
fs.mkdirSync(OUT, { recursive: true });

// ---- Which day? ----
function yesterdayNY() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
const day = args[0] || yesterdayNY();
const [Y, M, D] = day.split("-").map(Number);
const prettyDate = new Date(Y, M - 1, D).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

// ---- Tiny local web server for the game files ----
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const W = 540, H = 880;           // game area (scaled 2x later -> 1080 x 1760)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(8765, r));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  // Pretend it's noon on the chosen day; skip the first-visit help popup.
  await context.clock.install({ time: new Date(Y, M - 1, D, 12, 0, 0) });
  await context.addInitScript(() => { try { localStorage.setItem("aviationary-seen-help", "1"); } catch {} });
  await context.route(/supabase\.co/, (r) => r.abort());   // never send scores

  const page = await context.newPage();
  await page.goto("http://localhost:8765/?practice");
  await page.waitForSelector("#takeoff");
  // Video tidy-ups: no "(practice)" label, no personal stats/countdown on the results.
  await page.addStyleTag({ content: "#results .stats, #results .countdown, #results h3.section-title:has(+ .stats){display:none!important}" });
  await page.evaluate(() => {
    const el = document.getElementById("puzzle-no");
    el.textContent = el.textContent.replace(" (practice)", "");
    new MutationObserver(() => {
      const r = document.getElementById("results-no");
      if (r.textContent.includes("(practice)")) r.textContent = r.textContent.replace(" (practice)", "");
    }).observe(document.getElementById("results-no"), { childList: true, characterData: true, subtree: true });
  });

  const info = await page.evaluate(() => {
    const n = Aviationary.puzzleNumber();
    return Aviationary.cluesFor(n).map((clue) => {
      const groups = WORDS.syn[clue].split("|");
      return { clue, best: groups[groups.length - 1].split(" ").filter(Boolean)[0] };
    }).concat([{ n }]);
  });
  const puzzle = info.pop().n;
  console.log(`Puzzle #${puzzle} (${day}):`, info.map((w) => `${w.clue} -> ${w.best}`).join(", "));

  await wait(1500);
  await page.click("#takeoff");
  await wait(1600);

  for (const { best } of info) {
    await page.keyboard.type(best, { delay: 110 });
    await wait(500);
    await page.keyboard.press("Enter");
    await wait(3000);                              // let the Star animation play
    await page.click("#next");
    await wait(1200);
  }

  // Results screen: hold on the final altitude for a moment, then end.
  await wait(3500);

  const video = page.video();
  await context.close();
  await browser.close();
  server.close();
  const raw = await video.path();

  // ---- Add caption banner on top and make it 1080x1920 (Instagram Reels) ----
  const final = path.join(OUT, `aviationary-${day}.mp4`);
  const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const esc = (s) => s.replace(/:/g, "\\:").replace(/'/g, "\u2019");
  const filter = [
    `[0:v]scale=1080:1760:flags=lanczos,pad=1080:1920:0:160:color=0x1d3b6a`,
    `drawtext=fontfile=${font}:text='${esc("Best answers for Aviationary #" + puzzle)}':fontcolor=white:fontsize=50:x=(w-text_w)/2:y=30`,
    `drawtext=fontfile=${font}:text='${esc(prettyDate)}':fontcolor=0xffd36b:fontsize=40:x=(w-text_w)/2:y=96`,
  ].join(",");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", filter, "-r", "30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-an", final]);
  fs.unlinkSync(raw);

  fs.writeFileSync(path.join(OUT, `aviationary-${day}-caption.txt`),
    `Best answers for Aviationary #${puzzle} – ${prettyDate} ✈️⭐\n\n` +
    info.map((w) => `${w.clue.toUpperCase()} → ${w.best.toUpperCase()}`).join("\n") +
    `\n\nHow high can you fly today? Play free: aviationary.netlify.app\n#aviationary #wordgame #dailypuzzle #synonyms #wordle`);
  console.log("Done:", final);
})().catch((e) => { console.error(e); process.exit(1); });
