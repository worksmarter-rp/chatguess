// govment.org — Automated Content Pipeline v2
// Scout → Writer → DALL-E Image → articles.json → index.html rebuild
// Run: node scripts/generate-article.js

const fs    = require("fs");
const path  = require("path");
const https = require("https");

// ─── CONFIG ───────────────────────────────────────────────
const CLAUDE_MODEL  = "claude-sonnet-4-20250514";
const ROOT          = path.join(__dirname, "..");
const ARTICLES_JSON = path.join(ROOT, "articles.json");
const INDEX_HTML    = path.join(ROOT, "index.html");

// ─── HTTP HELPERS ─────────────────────────────────────────
function httpsPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname, path: urlPath, method: "POST",
        headers: { ...headers, "Content-Type": "application/json",
                   "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error("Bad JSON: " + raw.slice(0, 200))); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── CLAUDE API ───────────────────────────────────────────
async function callClaude(systemPrompt, userMessage, useWebSearch = false) {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };
  if (useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }
  const response = await httpsPost(
    "api.anthropic.com", "/v1/messages",
    { "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05" },
    body
  );
  if (response.error) throw new Error(`Claude API: ${response.error.message}`);
  return response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean).join("\n");
}

// ─── OPENAI DALL-E 3 ──────────────────────────────────────
async function generateImage(prompt, filename) {
  console.log("🎨 IMAGE AGENT: Calling DALL-E 3...");
  const response = await httpsPost(
    "api.openai.com", "/v1/images/generations",
    { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
    { model: "dall-e-3", prompt, size: "1792x1024", quality: "standard", n: 1 }
  );
  if (response.error) throw new Error(`DALL-E: ${response.error.message}`);
  const imageUrl = response.data[0].url;
  console.log("   Downloading image...");
  const buf = await httpsGet(imageUrl);
  fs.writeFileSync(path.join(ROOT, filename), buf);
  console.log(`✅ IMAGE: Saved as ${filename}`);
}

// ─── UTILITIES ────────────────────────────────────────────
function slugify(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function fmtDate(iso) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US",
    { month: "short", day: "2-digit", year: "numeric" }).toUpperCase();
}

// ─── SCOUT PROMPT ─────────────────────────────────────────
const SCOUT_SYSTEM = `You are the chief satirist for govment.org, a deadpan political satire website.

Search the web for today's U.S. political and government news. Find the single best 
story to satirize — one that is absurd on its face, requires no editorializing, and 
plays equally funny across the political spectrum. Avoid culture war flashpoints.
Target: government incompetence, logical paradoxes, bureaucratic absurdity, or 
officials doing things that satirize themselves.

Return ONLY a valid JSON object, no preamble, no markdown fences:
{
  "headline": "The satirical headline",
  "deck": "One sentence subtitle that lands the joke",
  "excerpt": "Two sentence teaser for the homepage card",
  "angle": "The satirical approach in one sentence",
  "sourceUrl": "URL of the real news article",
  "sourcePublication": "Name of publication e.g. NBC News",
  "sourceTitle": "Real headline of the source article",
  "imagePrompt": "DALL-E 3 prompt: photojournalism style, desaturated sepia tones, no readable text, AP wire photo aesthetic, no watermarks",
  "imageFilename": "slug-style-name-no-extension",
  "category": "One of: Executive Branch | Fiscal Mysteries | Legislative Achievement | Constitutional Paradoxes | War & Stuff | Science & Policy | Job Postings",
  "tags": ["tag1", "tag2", "tag3", "tag4"]
}`;

// ─── WRITER PROMPT ────────────────────────────────────────
const WRITER_SYSTEM = `You are the chief satirist for govment.org, a deadpan political satire website 
in the tradition of The Onion. Voice: authoritative, deadpan, absurdist. 
Headlines sound real. Content goes off the rails in the most believable way.

Rules:
- Never editorialize or take sides — let facts do the satirical work
- Attribute quotes to "Bureau of [Something]" or unnamed officials
- Include at least one real verified fact that is funnier than anything invented
- End with a short paragraph that lands quietly
- Write 6-8 paragraphs

Return ONLY the article body as HTML paragraphs. Start with the first <p> tag.
No headline, no deck, no byline, no wrapper divs.`;

// ─── ARTICLE PAGE TEMPLATE ────────────────────────────────
function buildArticlePage(brief, bodyHtml, allArticles) {
  const date = fmtDate(brief.date);

  const related = allArticles
    .filter((a) => a.slug !== brief.slug).slice(0, 3)
    .map((a) => `
      <div class="related-item">
        <div class="r-cat">${a.category}</div>
        <a href="/${a.slug}.html">${a.headline}</a>
      </div>`).join("");

  const tickerLinks = allArticles.slice(0, 5)
    .map((a) => `<a href="/${a.slug}.html">&#9889; ${a.headline}</a>`)
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${brief.headline} | Govment.org</title>
  <meta name="description" content="${brief.deck}" />
  <meta property="og:title" content="${brief.headline}" />
  <meta property="og:description" content="${brief.deck}" />
  <meta property="og:image" content="https://govment.org/${brief.imageFilename}.png" />
  <meta property="og:url" content="https://govment.org/${brief.slug}.html" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root{--ink:#1a1008;--paper:#f5f0e8;--aged:#e8e0cc;--red:#c0392b;--gold:#8b6914;--mid:#5a4a2a;--light:#9a8c72;--rule:#c8b898}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--paper);color:var(--ink);font-family:'Source Serif 4',Georgia,serif;font-size:18px;line-height:1.75}
    a{color:inherit;text-decoration:none}
    .site-header{background:var(--ink);text-align:center;padding:28px 24px 20px;border-bottom:4px solid var(--red)}
    .site-flag{font-family:'Playfair Display',serif;font-size:clamp(38px,8vw,72px);font-weight:900;letter-spacing:-2px;color:#fff;line-height:1;margin-bottom:6px}
    .site-flag span{color:var(--red)}
    .site-tagline{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:4px;color:var(--light);text-transform:uppercase;margin-bottom:16px}
    .site-nav{display:flex;justify-content:center;gap:24px;flex-wrap:wrap}
    .site-nav a{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:3px;color:var(--rule);text-transform:uppercase;transition:color .2s}
    .site-nav a:hover{color:#fff}
    .ticker{background:var(--red);color:#fff;font-family:'DM Mono',monospace;font-size:11px;padding:6px 0;overflow:hidden;white-space:nowrap}
    .ticker-inner{display:inline-block;animation:scroll-ticker 50s linear infinite}
    .ticker-inner a{margin:0 40px;color:#fff;text-decoration:none}
    .ticker-inner a:hover{color:#ffcccc;text-decoration:underline}
    @keyframes scroll-ticker{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}
    .article-wrap{max-width:780px;margin:0 auto;padding:48px 24px 80px}
    .kicker{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--red);margin-bottom:16px;display:flex;align-items:center;gap:12px}
    .kicker::after{content:'';flex:1;height:1px;background:var(--rule)}
    h1{font-family:'Playfair Display',serif;font-size:clamp(28px,5vw,52px);font-weight:900;line-height:1.1;letter-spacing:-1px;margin-bottom:20px}
    .deck{font-size:20px;font-weight:600;line-height:1.4;color:var(--mid);border-left:3px solid var(--red);padding-left:16px;margin-bottom:24px}
    .byline-bar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:12px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule);margin-bottom:36px}
    .byline{font-family:'DM Mono',monospace;font-size:11px;color:var(--mid);letter-spacing:1px}
    .byline strong{color:var(--gold)}
    .datestamp{font-family:'DM Mono',monospace;font-size:10px;color:var(--light);letter-spacing:2px}
    .article-image{width:100%;margin-bottom:12px;background:var(--ink);aspect-ratio:16/9;overflow:hidden}
    .article-image img{width:100%;height:100%;object-fit:cover;display:block}
    .image-caption{font-family:'DM Mono',monospace;font-size:10px;color:var(--light);letter-spacing:1px;margin-bottom:32px;padding-left:10px;border-left:2px solid var(--rule)}
    .article-body p{margin-bottom:24px}
    .article-body p:first-child::first-letter{font-family:'Playfair Display',serif;font-size:72px;font-weight:900;float:left;line-height:.75;margin:8px 8px 0 0;color:var(--red)}
    blockquote{margin:36px 0;padding:0 0 0 24px;border-left:4px solid var(--gold)}
    blockquote p{font-family:'Playfair Display',serif;font-size:22px;font-style:italic;color:var(--mid);line-height:1.5;margin:0 0 8px!important}
    blockquote cite{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--light);text-transform:uppercase;font-style:normal}
    .source-box{background:var(--aged);border:1px solid var(--rule);padding:16px 20px;margin:36px 0;display:flex;align-items:flex-start;gap:14px}
    .source-icon{font-size:20px;flex-shrink:0;margin-top:2px}
    .source-label{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:3px;color:var(--light);text-transform:uppercase;margin-bottom:4px}
    .source-title{font-size:15px;font-weight:600;color:var(--ink);line-height:1.4}
    .source-box a{color:var(--red);font-family:'DM Mono',monospace;font-size:10px;display:inline-block;margin-top:6px;border-bottom:1px solid var(--rule);padding-bottom:1px}
    .tags{margin-top:32px;display:flex;flex-wrap:wrap;gap:8px}
    .tag{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;padding:4px 10px;border:1px solid var(--rule);color:var(--mid)}
    .disclaimer{margin-top:48px;padding-top:16px;border-top:2px solid var(--rule);font-family:'DM Mono',monospace;font-size:10px;color:var(--light);letter-spacing:1px;line-height:1.8}
    .related{margin-top:56px;padding-top:20px;border-top:3px double var(--rule)}
    .related-label{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:4px;color:var(--light);text-transform:uppercase;margin-bottom:20px}
    .related-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px}
    .related-item{border-top:2px solid var(--rule);padding-top:12px}
    .related-item a{font-family:'Playfair Display',serif;font-size:16px;font-weight:700;color:var(--ink);line-height:1.3;display:block;transition:color .2s}
    .related-item a:hover{color:var(--red)}
    .r-cat{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--red);text-transform:uppercase;margin-bottom:6px}
    .site-footer{background:var(--ink);color:var(--light);text-align:center;padding:32px 24px;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;line-height:2}
    .site-footer a{color:var(--rule)}
  </style>
</head>
<body>
<header class="site-header">
  <div class="site-flag">GOV<span>MENT</span>.ORG</div>
  <div class="site-tagline">Your Source for Unconventional Truths Since the Beginning of the End</div>
  <nav class="site-nav">
    <a href="/">Home</a>
    <a href="#">Executive Branch</a>
    <a href="#">Fiscal Mysteries</a>
    <a href="#">War &amp; Stuff</a>
    <a href="/president-job-posting.html">Job Postings</a>
    <a href="#">About</a>
  </nav>
</header>
<div class="ticker">
  <div class="ticker-inner">
    ${tickerLinks}
  </div>
</div>
<main class="article-wrap">
  <div class="kicker">${brief.category}</div>
  <h1>${brief.headline}</h1>
  <p class="deck">${brief.deck}</p>
  <div class="byline-bar">
    <div class="byline">By <strong>Staff Reporter, Bureau of Government Affairs</strong></div>
    <div class="datestamp">${date} &nbsp;&middot;&nbsp; GOVMENT.ORG</div>
  </div>
  <div class="article-image">
    <img src="/${brief.imageFilename}.png" alt="${brief.headline}" />
  </div>
  <p class="image-caption">Govment.org photo illustration &nbsp;|&nbsp; ${date}</p>
  <div class="article-body">
    ${bodyHtml}
  </div>
  <div class="source-box">
    <div class="source-icon">&#128240;</div>
    <div>
      <div class="source-label">Read the Actual Story &mdash; ${brief.sourcePublication}</div>
      <div class="source-title">${brief.sourceTitle}</div>
      <a href="${brief.sourceUrl}" target="_blank" rel="noopener noreferrer">Read the full report at ${brief.sourcePublication} &rarr;</a>
    </div>
  </div>
  <div class="tags">
    ${brief.tags.map((t) => `<span class="tag">${t}</span>`).join("\n    ")}
  </div>
  <div class="disclaimer">
    DISCLAIMER: Govment.org is a satirical publication. All articles are works of fiction and parody.<br>
    Any resemblance to actual government behavior is purely because it is.
  </div>
  <div class="related">
    <div class="related-label">More From Govment.org</div>
    <div class="related-grid">${related}</div>
  </div>
</main>
<footer class="site-footer">
  <div style="font-size:22px;font-family:'Playfair Display',serif;color:#fff;margin-bottom:8px;">GOVMENT.ORG</div>
  <div>Unveiling the Truth Since Someone Had To &nbsp;&middot;&nbsp; <a href="/">Home</a> &nbsp;&middot;&nbsp; <a href="#">Archive</a></div>
  <div style="margin-top:12px;color:#3a3020;">&copy; ${new Date().getFullYear()} Govment.org &nbsp;&middot;&nbsp; Satire &nbsp;&middot;&nbsp; All facts approximate &nbsp;&middot;&nbsp; Not liable for democracy</div>
</footer>
</body>
</html>`;
}

// ─── INDEX.HTML BUILDER ───────────────────────────────────
function buildIndexPage(articles) {
  const hero   = articles[0];
  const grid   = articles.slice(1, 4);
  const archive = articles.slice(0, 5);

  const tickerLinks = articles.slice(0, 6)
    .map((a) => `<a href="/${a.slug}.html">&#9889; ${a.headline}</a>`)
    .join("\n    ");

  const gridCards = grid.map((a) => `
      <div class="grid-card">
        <div class="grid-card-image">
          <img src="/${a.imageFilename}.png" alt="${a.headline}" />
        </div>
        <div class="card-cat">${a.category}</div>
        <h3><a href="/${a.slug}.html">${a.headline}</a></h3>
        <p class="card-excerpt">${a.excerpt}</p>
        <div class="card-meta">
          <span>${fmtDate(a.date)}</span>
          <a href="/${a.slug}.html" style="color:var(--red);letter-spacing:2px;">Read &rarr;</a>
        </div>
      </div>`).join("");

  const archiveItems = archive.map((a, i) => `
      <div class="classic-item">
        <div class="classic-num">0${i + 1}</div>
        <div>
          <h5><a href="/${a.slug}.html">${a.headline}</a></h5>
          <p>${a.excerpt}</p>
        </div>
      </div>`).join("");

  const allTags = [...new Set(articles.flatMap((a) => a.tags))].slice(0, 16);
  const tagSpans = allTags.map((t) => `<span class="sidebar-tag">${t}</span>`).join("\n        ");

  const todayStr = new Date().toLocaleDateString("en-US",
    { weekday:"long", year:"numeric", month:"long", day:"numeric" }).toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Govment.org &mdash; Unveiling the Truth</title>
  <meta name="description" content="Govment.org: Satirical takes on government, politics, and the peculiarities of power." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root{--ink:#1a1008;--paper:#f5f0e8;--aged:#e8e0cc;--red:#c0392b;--gold:#8b6914;--mid:#5a4a2a;--light:#9a8c72;--rule:#c8b898}
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--paper);color:var(--ink);font-family:'Source Serif 4',Georgia,serif;font-size:17px;line-height:1.7}
    a{color:inherit;text-decoration:none}
    .site-header{background:var(--ink);text-align:center;padding:36px 24px 24px;border-bottom:4px solid var(--red)}
    .site-flag{font-family:'Playfair Display',serif;font-size:clamp(52px,12vw,108px);font-weight:900;letter-spacing:-3px;color:#fff;line-height:1;margin-bottom:8px}
    .site-flag span{color:var(--red)}
    .site-tagline{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:5px;color:var(--light);text-transform:uppercase;margin-bottom:6px}
    .site-sub{font-family:'Source Serif 4',serif;font-style:italic;font-size:14px;color:#6b5a3a;margin-bottom:22px}
    .site-nav{display:flex;justify-content:center;gap:28px;flex-wrap:wrap;padding-top:16px;border-top:1px solid #2a2010}
    .site-nav a{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:3px;color:var(--rule);text-transform:uppercase;transition:color .2s}
    .site-nav a:hover{color:#fff}
    .ticker{background:var(--red);color:#fff;font-family:'DM Mono',monospace;font-size:11px;padding:7px 0;overflow:hidden;white-space:nowrap}
    .ticker-inner{display:inline-block;animation:scroll-ticker 50s linear infinite}
    .ticker-inner a{margin:0 48px;color:#fff;text-decoration:none;white-space:nowrap}
    .ticker-inner a:hover{color:#ffcccc;text-decoration:underline}
    @keyframes scroll-ticker{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}
    .date-banner{display:flex;align-items:center;justify-content:space-between;padding:10px 32px;border-bottom:1px solid var(--rule)}
    .dt{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--light)}
    .edition{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:3px;color:var(--rule);text-transform:uppercase}
    .page-wrap{max-width:1200px;margin:0 auto;padding:0 24px}
    .hero{display:grid;grid-template-columns:1fr 1fr;border-bottom:2px solid var(--rule);margin-top:32px}
    .hero-image{background:var(--ink);aspect-ratio:4/3;overflow:hidden}
    .hero-image img{width:100%;height:100%;object-fit:cover;opacity:.9;display:block}
    .hero-content{padding:32px 36px;display:flex;flex-direction:column;justify-content:center;border-left:1px solid var(--rule)}
    .hero-kicker{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:4px;color:var(--red);text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;gap:10px}
    .hero-kicker::before{content:'';width:24px;height:2px;background:var(--red);flex-shrink:0}
    .hero h2{font-family:'Playfair Display',serif;font-size:clamp(24px,3.5vw,40px);font-weight:900;line-height:1.1;margin-bottom:16px}
    .hero h2 a:hover{color:var(--red)}
    .hero-deck{font-size:16px;color:var(--mid);line-height:1.6;margin-bottom:20px;font-style:italic}
    .read-more{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--red);display:inline-flex;align-items:center;gap:8px;transition:gap .2s}
    .read-more:hover{gap:12px}
    .read-more::after{content:'→'}
    .section-rule{display:flex;align-items:center;gap:16px;padding:28px 0 20px}
    .rule-label{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:5px;text-transform:uppercase;color:var(--light);white-space:nowrap}
    .section-rule::before,.section-rule::after{content:'';flex:1;height:1px;background:var(--rule)}
    .article-grid{display:grid;grid-template-columns:repeat(3,1fr);border-top:2px solid var(--ink);border-bottom:2px solid var(--rule);margin-bottom:40px}
    .grid-card{padding:24px;border-right:1px solid var(--rule);display:flex;flex-direction:column}
    .grid-card:last-child{border-right:none}
    .grid-card-image{aspect-ratio:16/9;background:var(--ink);margin-bottom:16px;overflow:hidden}
    .grid-card-image img{width:100%;height:100%;object-fit:cover;display:block}
    .card-cat{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:3px;color:var(--red);text-transform:uppercase;margin-bottom:8px}
    .grid-card h3{font-family:'Playfair Display',serif;font-size:19px;font-weight:700;line-height:1.25;margin-bottom:10px;flex:1}
    .grid-card h3 a:hover{color:var(--red)}
    .card-excerpt{font-size:14px;color:var(--mid);line-height:1.6;margin-bottom:14px}
    .card-meta{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:var(--light);display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--aged);padding-top:10px;margin-top:auto}
    .lower-grid{display:grid;grid-template-columns:2fr 1fr;gap:40px;padding-bottom:56px;border-top:2px solid var(--rule);padding-top:32px}
    .classics h4,.sidebar h4{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:var(--light);margin-bottom:20px;padding-bottom:10px;border-bottom:2px solid var(--rule)}
    .classic-item{display:grid;grid-template-columns:auto 1fr;gap:16px;padding:16px 0;border-bottom:1px solid var(--aged);align-items:start}
    .classic-num{font-family:'Playfair Display',serif;font-size:32px;font-weight:900;color:var(--rule);line-height:1;width:36px}
    .classic-item h5{font-family:'Playfair Display',serif;font-size:17px;font-weight:700;line-height:1.3;margin-bottom:4px}
    .classic-item h5 a:hover{color:var(--red)}
    .classic-item p{font-size:13px;color:var(--mid);line-height:1.5}
    .sidebar-govmentcheck{margin-bottom:20px;border:2px solid var(--rule);overflow:hidden}
    .sidebar-govmentcheck img{width:100%;display:block;filter:sepia(20%) contrast(1.05)}
    .sidebar-about{background:var(--ink);color:var(--paper);padding:24px;margin-bottom:28px}
    .sa-flag{font-family:'Playfair Display',serif;font-size:28px;font-weight:900;color:#fff}
    .sa-flag span{color:var(--red)}
    .sidebar-about p{font-size:13px;color:var(--light);line-height:1.7;margin-top:10px}
    .sidebar-taglist{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}
    .sidebar-tag{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;padding:5px 10px;border:1px solid var(--rule);color:var(--mid)}
    .stat-row{display:flex;border:1px solid var(--rule);margin-bottom:28px}
    .stat-cell{flex:1;padding:14px;text-align:center;border-right:1px solid var(--rule)}
    .stat-cell:last-child{border-right:none}
    .stat-num{font-family:'Playfair Display',serif;font-size:26px;font-weight:900;color:var(--red);line-height:1}
    .stat-lbl{font-family:'DM Mono',monospace;font-size:8px;letter-spacing:2px;color:var(--light);text-transform:uppercase;margin-top:4px}
    .site-footer{background:var(--ink);color:var(--light);padding:40px 32px 28px}
    .footer-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr;gap:40px;padding-bottom:28px;border-bottom:1px solid #2a2010;margin-bottom:20px}
    .footer-brand .fb-flag{font-family:'Playfair Display',serif;font-size:32px;font-weight:900;color:#fff;margin-bottom:10px}
    .footer-brand .fb-flag span{color:var(--red)}
    .footer-brand p,.footer-col a{font-size:13px;color:#4a3a20}
    .footer-brand p{line-height:1.7}
    .footer-col h6{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:4px;text-transform:uppercase;color:var(--rule);margin-bottom:14px}
    .footer-col ul{list-style:none}
    .footer-col li{margin-bottom:8px}
    .footer-col a:hover{color:var(--rule)}
    .footer-bottom{max-width:1200px;margin:0 auto;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
    .footer-bottom p{font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;color:#2a2010}
    @media(max-width:900px){.hero,.article-grid,.lower-grid,.footer-inner{grid-template-columns:1fr}.hero-content{border-left:none;border-top:1px solid var(--rule)}.grid-card{border-right:none;border-bottom:1px solid var(--rule)}}
  </style>
</head>
<body>
<header class="site-header">
  <div class="site-flag">GOV<span>MENT</span>.ORG</div>
  <div class="site-tagline">Unveiling the Truth Since Someone Had To</div>
  <div class="site-sub">Best spoken with a thick Floridian accent. The 'V' is optional.</div>
  <nav class="site-nav">
    <a href="/">Home</a>
    <a href="#">Executive Branch</a>
    <a href="#">Fiscal Mysteries</a>
    <a href="#">War &amp; Stuff</a>
    <a href="/president-job-posting.html">Job Postings</a>
    <a href="#">Science &amp; Policy</a>
    <a href="#">Archive</a>
  </nav>
</header>
<div class="ticker">
  <div class="ticker-inner">
    ${tickerLinks}
  </div>
</div>
<div class="date-banner">
  <span class="dt">${todayStr}</span>
  <span class="edition">The Govment Gazette &nbsp;&middot;&nbsp; ${articles.length} Articles Published</span>
</div>
<div class="page-wrap">
  <div class="hero">
    <div class="hero-image">
      <img src="/${hero.imageFilename}.png" alt="${hero.headline}" />
    </div>
    <div class="hero-content">
      <div class="hero-kicker">${hero.category} &nbsp;&middot;&nbsp; ${fmtDate(hero.date)}</div>
      <h2><a href="/${hero.slug}.html">${hero.headline}</a></h2>
      <p class="hero-deck">${hero.deck}</p>
      <a class="read-more" href="/${hero.slug}.html">Read Full Article</a>
    </div>
  </div>
  <div class="section-rule"><span class="rule-label">Latest Dispatches</span></div>
  <div class="article-grid">
    ${gridCards}
  </div>
  <div class="lower-grid">
    <div class="classics">
      <h4>From the Govment Archives</h4>
      ${archiveItems}
    </div>
    <aside class="sidebar">
      <div class="sidebar-govmentcheck">
        <img src="/GovmentCheck.jpg" alt="Govment Check" />
      </div>
      <div class="sidebar-about">
        <div class="sa-flag">GOV<span>MENT</span></div>
        <p>A satirical publication dedicated to the peculiarities of government and power. The name is a slang abbreviation best spoken with a thick Floridian accent. The 'V' can be pronounced as a 'B', a 'V', or omitted entirely. We consider this a metaphor.</p>
      </div>
      <div class="stat-row">
        <div class="stat-cell"><div class="stat-num">${articles.length}</div><div class="stat-lbl">Articles</div></div>
        <div class="stat-cell"><div class="stat-num">0</div><div class="stat-lbl">Retractions</div></div>
        <div class="stat-cell"><div class="stat-num">&infin;</div><div class="stat-lbl">Source Material</div></div>
      </div>
      <h4>Browse by Topic</h4>
      <div class="sidebar-taglist">
        ${tagSpans}
      </div>
    </aside>
  </div>
</div>
<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="fb-flag">GOV<span>MENT</span>.ORG</div>
      <p>Govment.org is a satirical publication. All articles are works of fiction and parody. Any resemblance to actual government behavior is purely because it is. We are not responsible for democracy, its current condition, or its loading docks.</p>
    </div>
    <div class="footer-col">
      <h6>Sections</h6>
      <ul>
        <li><a href="#">Executive Branch</a></li>
        <li><a href="#">Fiscal Mysteries</a></li>
        <li><a href="#">War &amp; Stuff</a></li>
        <li><a href="#">Science &amp; Policy</a></li>
        <li><a href="/president-job-posting.html">Job Postings</a></li>
        <li><a href="#">Archive</a></li>
      </ul>
    </div>
    <div class="footer-col">
      <h6>The Bureau</h6>
      <ul>
        <li><a href="#">About Govment.org</a></li>
        <li><a href="#">Satire Disclaimer</a></li>
        <li><a href="#">Contact the Bureau</a></li>
        <li><a href="#">Submit a Tip</a></li>
        <li><a href="#">Corrections (0)</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    <p>&copy; ${new Date().getFullYear()} GOVMENT.ORG &nbsp;&middot;&nbsp; SATIRE &nbsp;&middot;&nbsp; ALL FACTS APPROXIMATE &nbsp;&middot;&nbsp; NOT LIABLE FOR DEMOCRACY</p>
    <p>BEST SPOKEN WITH A THICK FLORIDIAN ACCENT</p>
  </div>
</footer>
</body>
</html>`;
}

// ─── ARTICLES.JSON ────────────────────────────────────────
function updateArticlesJson(brief) {
  let articles = [];
  if (fs.existsSync(ARTICLES_JSON)) {
    try { articles = JSON.parse(fs.readFileSync(ARTICLES_JSON, "utf8")); }
    catch (e) { articles = []; }
  }
  articles = articles.filter((a) => a.slug !== brief.slug);
  articles.unshift({
    slug:              brief.slug,
    headline:          brief.headline,
    deck:              brief.deck,
    excerpt:           brief.excerpt,
    category:          brief.category,
    tags:              brief.tags,
    imageFilename:     brief.imageFilename,
    sourceUrl:         brief.sourceUrl,
    sourcePublication: brief.sourcePublication,
    date:              new Date().toISOString().split("T")[0],
  });
  fs.writeFileSync(ARTICLES_JSON, JSON.stringify(articles, null, 2), "utf8");
  console.log(`✅ ARTICLES.JSON: ${articles.length} total articles`);
  return articles;
}

// ─── MAIN ─────────────────────────────────────────────────
async function run() {
  console.log("🔍 SCOUT AGENT: Searching for today's best satirical target...");

  const scoutRaw = await callClaude(
    SCOUT_SYSTEM,
    `Today is ${new Date().toDateString()}. Search the web for today's U.S. political and government news. Find the single best story to satirize and return the JSON brief.`,
    true
  );

  let brief;
  try {
    const clean = scoutRaw.replace(/```json|```/g, "").trim();
    brief = JSON.parse(clean.match(/\{[\s\S]*\}/)[0]);
  } catch (e) {
    throw new Error("Scout JSON parse failed: " + scoutRaw.slice(0, 300));
  }
  brief.slug = slugify(brief.headline);
  console.log(`✅ SCOUT: "${brief.headline}"`);
  console.log(`   Angle: ${brief.angle}`);
  console.log(`   Source: ${brief.sourcePublication}`);

  console.log("⏳ Waiting 65s for rate limit window...");
  await sleep(65000);

  console.log("✍️  WRITER AGENT: Generating article...");
  const articleBody = await callClaude(
    WRITER_SYSTEM,
    `Write a full satirical article for govment.org based on this brief:\n${JSON.stringify(brief, null, 2)}`
  );
  console.log("✅ WRITER: Done.");

  // Image — only if OPENAI_API_KEY present
  if (process.env.OPENAI_API_KEY) {
    await generateImage(brief.imagePrompt, `${brief.imageFilename}.png`);
  } else {
    console.log("⚠️  No OPENAI_API_KEY — skipping image, prompt saved for manual use.");
  }

  // Update articles.json
  const allArticles = updateArticlesJson(brief);

  // Write article HTML
  const articleHtml = buildArticlePage(brief, articleBody, allArticles);
  fs.writeFileSync(path.join(ROOT, `${brief.slug}.html`), articleHtml, "utf8");
  console.log(`✅ ARTICLE: ${brief.slug}.html`);

  // Rebuild index.html
  const indexHtml = buildIndexPage(allArticles);
  fs.writeFileSync(INDEX_HTML, indexHtml, "utf8");
  console.log("✅ INDEX: index.html rebuilt.");

  // Save image prompt for reference
  fs.mkdirSync(path.join(ROOT, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "scripts", "last-image-prompt.json"),
    JSON.stringify({ filename: `${brief.imageFilename}.png`, prompt: brief.imagePrompt, article: brief.slug }, null, 2),
    "utf8"
  );

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("PIPELINE COMPLETE");
  console.log(`Article : ${brief.slug}.html`);
  console.log(`Image   : ${brief.imageFilename}.png`);
  console.log(`Category: ${brief.category}`);
  console.log(`Source  : ${brief.sourceUrl}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

run().catch((err) => {
  console.error("❌ Pipeline error:", err.message);
  process.exit(1);
});
