// govment.org — Automated Content Pipeline
// Scout Agent → Writer Agent → Commits new article HTML to repo
// Run: node scripts/generate-article.js

const fs = require("fs");
const path = require("path");
const https = require("https");

// ─── CONFIG ───────────────────────────────────────────────
const MODEL = "claude-sonnet-4-20250514";
const OUTPUT_DIR = path.join(__dirname, "..");  // repo root

// ─── UTILITIES ────────────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error("Failed to parse response: " + raw));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function callClaude(systemPrompt, userMessage, useWebSearch = false) {
  const body = {
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  if (useWebSearch) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const response = await httpsPost(
    "api.anthropic.com",
    "/v1/messages",
    {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "web-search-2025-03-05",
    },
    body
  );

  if (response.error) {
    throw new Error(`Claude API error: ${response.error.message}`);
  }

  return response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function getTodayDate() {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).toUpperCase();
}

function getISODate() {
  return new Date().toISOString().split("T")[0];
}

// ─── SCOUT AGENT ──────────────────────────────────────────
const SCOUT_SYSTEM = `You are the chief satirist for govment.org, a deadpan political satire website.
Your job is to find today's most satirizable U.S. government and political news.

Search the web for today's political news. Find the single best story to satirize — 
one that is absurd on its face, requires no editorializing, and plays equally funny 
to people across the political spectrum. Avoid culture war flashpoints. 
Target: pure government incompetence, logical paradoxes, bureaucratic absurdity, 
or officials doing/saying things that satirize themselves.

Return ONLY a valid JSON object with these exact fields, nothing else:
{
  "headline": "The satirical headline",
  "deck": "One sentence subtitle that lands the joke",
  "angle": "The satirical approach in one sentence",
  "sourceUrl": "URL of the real news article",
  "sourcePublication": "Name of publication",
  "sourceTitle": "Real headline of the source article",
  "imagePrompt": "A DALL-E 3 prompt for a photojournalism-style image. Desaturated, sepia-toned, no readable text, AP wire photo aesthetic.",
  "imageFilename": "slug-style-filename (no extension)",
  "category": "One of: Executive Branch | Fiscal Mysteries | Legislative Achievement | Constitutional Paradoxes | War & Stuff | Science & Policy | Job Postings",
  "tags": ["tag1", "tag2", "tag3"]
}`;

// ─── WRITER AGENT ─────────────────────────────────────────
const WRITER_SYSTEM = `You are the chief satirist for govment.org, a deadpan political satire website 
in the tradition of The Onion. Your voice: authoritative, deadpan, absurdist. 
Headlines sound real. Content goes off the rails in the most believable way.

Rules:
- Never editorialize or take sides — let the facts do the satirical work
- Attribute fake quotes to "Bureau of [Something]" or unnamed officials
- Include at least one real verified fact that is funnier than anything invented
- End with a short final paragraph that lands quietly
- Write 6-8 paragraphs of body copy

You will receive a JSON brief. Return ONLY the complete article body as HTML — 
paragraphs only, no wrapping divs, no head/body tags.
Start directly with the first <p> tag.
Do not include the headline, deck, byline, or any wrapper elements.
Just the article body paragraphs and any blockquote pull quotes.`;

// ─── HTML TEMPLATE ────────────────────────────────────────
function buildArticlePage(brief, articleBodyHtml) {
  const date = getTodayDate();
  const isoDate = getISODate();

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
    :root {
      --ink: #1a1008; --paper: #f5f0e8; --aged: #e8e0cc;
      --red: #c0392b; --gold: #8b6914; --mid: #5a4a2a;
      --light: #9a8c72; --rule: #c8b898;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--paper); color: var(--ink); font-family: 'Source Serif 4', Georgia, serif; font-size: 18px; line-height: 1.75; }
    a { color: inherit; text-decoration: none; }
    .site-header { background: var(--ink); color: var(--paper); text-align: center; padding: 28px 24px 20px; border-bottom: 4px solid var(--red); }
    .site-flag { font-family: 'Playfair Display', serif; font-size: clamp(38px, 8vw, 72px); font-weight: 900; letter-spacing: -2px; color: #fff; line-height: 1; margin-bottom: 6px; }
    .site-flag span { color: var(--red); }
    .site-tagline { font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 4px; color: var(--light); text-transform: uppercase; margin-bottom: 16px; }
    .site-nav { display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; }
    .site-nav a { font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 3px; color: var(--rule); text-transform: uppercase; transition: color 0.2s; }
    .site-nav a:hover { color: #fff; }
    .ticker { background: var(--red); color: #fff; font-family: 'DM Mono', monospace; font-size: 11px; padding: 6px 0; overflow: hidden; white-space: nowrap; }
    .ticker-inner { display: inline-block; animation: scroll-ticker 45s linear infinite; }
    .ticker-inner a { margin: 0 40px; color: #fff; text-decoration: none; }
    .ticker-inner a:hover { color: #ffcccc; text-decoration: underline; }
    @keyframes scroll-ticker { from { transform: translateX(100vw); } to { transform: translateX(-100%); } }
    .article-wrap { max-width: 780px; margin: 0 auto; padding: 48px 24px 80px; }
    .kicker { font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 4px; text-transform: uppercase; color: var(--red); margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
    .kicker::after { content: ''; flex: 1; height: 1px; background: var(--rule); }
    h1 { font-family: 'Playfair Display', serif; font-size: clamp(28px, 5vw, 52px); font-weight: 900; line-height: 1.1; letter-spacing: -1px; margin-bottom: 20px; }
    .deck { font-size: 20px; font-weight: 600; line-height: 1.4; color: var(--mid); border-left: 3px solid var(--red); padding-left: 16px; margin-bottom: 24px; }
    .byline-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 12px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin-bottom: 36px; }
    .byline { font-family: 'DM Mono', monospace; font-size: 11px; color: var(--mid); letter-spacing: 1px; }
    .byline strong { color: var(--gold); }
    .datestamp { font-family: 'DM Mono', monospace; font-size: 10px; color: var(--light); letter-spacing: 2px; }
    .article-image { width: 100%; margin-bottom: 12px; background: var(--ink); aspect-ratio: 16/9; overflow: hidden; }
    .article-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .image-caption { font-family: 'DM Mono', monospace; font-size: 10px; color: var(--light); letter-spacing: 1px; margin-bottom: 32px; padding-left: 10px; border-left: 2px solid var(--rule); }
    .article-body p { margin-bottom: 24px; }
    .article-body p:first-child::first-letter { font-family: 'Playfair Display', serif; font-size: 72px; font-weight: 900; float: left; line-height: 0.75; margin: 8px 8px 0 0; color: var(--red); }
    blockquote { margin: 36px 0; padding: 0 0 0 24px; border-left: 4px solid var(--gold); }
    blockquote p { font-family: 'Playfair Display', serif; font-size: 22px; font-style: italic; color: var(--mid); line-height: 1.5; margin: 0 0 8px !important; }
    blockquote cite { font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 2px; color: var(--light); text-transform: uppercase; font-style: normal; }
    .source-box { background: var(--aged); border: 1px solid var(--rule); padding: 16px 20px; margin: 36px 0; display: flex; align-items: flex-start; gap: 14px; }
    .source-box .source-icon { font-size: 20px; flex-shrink: 0; margin-top: 2px; }
    .source-box .source-label { font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: 3px; color: var(--light); text-transform: uppercase; margin-bottom: 4px; }
    .source-box .source-title { font-size: 15px; font-weight: 600; color: var(--ink); line-height: 1.4; }
    .source-box a { color: var(--red); font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 1px; display: inline-block; margin-top: 6px; border-bottom: 1px solid var(--rule); padding-bottom: 1px; }
    .tags { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 8px; }
    .tag { font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: 2px; text-transform: uppercase; padding: 4px 10px; border: 1px solid var(--rule); color: var(--mid); }
    .disclaimer { margin-top: 48px; padding-top: 16px; border-top: 2px solid var(--rule); font-family: 'DM Mono', monospace; font-size: 10px; color: var(--light); letter-spacing: 1px; line-height: 1.8; }
    .related { margin-top: 56px; padding-top: 20px; border-top: 3px double var(--rule); }
    .related-label { font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 4px; color: var(--light); text-transform: uppercase; margin-bottom: 20px; }
    .related-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
    .related-item { border-top: 2px solid var(--rule); padding-top: 12px; }
    .related-item a { font-family: 'Playfair Display', serif; font-size: 16px; font-weight: 700; color: var(--ink); line-height: 1.3; display: block; transition: color 0.2s; }
    .related-item a:hover { color: var(--red); }
    .related-item .r-cat { font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: 2px; color: var(--red); text-transform: uppercase; margin-bottom: 6px; }
    .site-footer { background: var(--ink); color: var(--light); text-align: center; padding: 32px 24px; font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 2px; line-height: 2; }
    .site-footer a { color: var(--rule); }
  </style>
</head>
<body>

<header class="site-header">
  <div class="site-flag">GOV<span>MENT</span>.ORG</div>
  <div class="site-tagline">Your Source for Unconventional Truths Since the Beginning of the End</div>
  <nav class="site-nav">
    <a href="/">Home</a>
    <a href="/#executive-branch">Executive Branch</a>
    <a href="/#fiscal-mysteries">Fiscal Mysteries</a>
    <a href="/#war-stuff">War &amp; Stuff</a>
    <a href="/president-job-posting.html">Job Postings</a>
    <a href="/#about">About</a>
  </nav>
</header>

<div class="ticker">
  <div class="ticker-inner">
    <a href="/no-kings-protest.html">&#9889; BREAKING: Nation's king permits millions to protest nation's king &middot; Paradox unresolved</a>
    <a href="/congress-mid-sentence-adjourn.html">&#9889; UPDATE: House adjourns before congressman can finish sentence</a>
    <a href="/dhs-warehouses-billion.html">&#9889; DEVELOPING: $1 billion in warehouses confirmed to be warehouses</a>
    <a href="/president-job-posting.html">&#9889; NOW HIRING: President of the United States &middot; Nuclear authority included</a>
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
    ${articleBodyHtml}
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
    <div class="related-grid">
      <div class="related-item">
        <div class="r-cat">Constitutional Paradoxes</div>
        <a href="/no-kings-protest.html">Nation's King Permits Millions to Protest Nation's King</a>
      </div>
      <div class="related-item">
        <div class="r-cat">Legislative Achievement</div>
        <a href="/congress-mid-sentence-adjourn.html">House Adjourns Before Congressman Can Finish Sentence</a>
      </div>
      <div class="related-item">
        <div class="r-cat">Fiscal Mysteries</div>
        <a href="/dhs-warehouses-billion.html">DHS Confirms $1 Billion in Warehouses Are Warehouses</a>
      </div>
    </div>
  </div>

</main>

<footer class="site-footer">
  <div style="font-size:22px; font-family:'Playfair Display',serif; color:#fff; margin-bottom:8px;">GOVMENT.ORG</div>
  <div>Unveiling the Truth Since Someone Had To &nbsp;&middot;&nbsp; <a href="/">Home</a> &nbsp;&middot;&nbsp; <a href="#">Archive</a></div>
  <div style="margin-top:12px; color:#3a3020;">&copy; ${new Date().getFullYear()} Govment.org &nbsp;&middot;&nbsp; Satire &nbsp;&middot;&nbsp; All facts approximate &nbsp;&middot;&nbsp; Not liable for democracy</div>
</footer>

</body>
</html>`;
}

// ─── MAIN PIPELINE ────────────────────────────────────────
async function run() {
  console.log("🔍 SCOUT AGENT: Searching for today's best satirical target...");

  // 1. Scout
  const scoutRaw = await callClaude(
    SCOUT_SYSTEM,
    `Today is ${new Date().toDateString()}. Search the web for today's U.S. political and government news. Find the single best story to satirize and return the JSON brief.`,
    true // use web search
  );

  let brief;
  try {
    const clean = scoutRaw.replace(/```json|```/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    brief = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error("Scout failed to return valid JSON: " + scoutRaw.slice(0, 300));
  }

  brief.slug = slugify(brief.headline);
  console.log(`✅ SCOUT: Found story — "${brief.headline}"`);
  console.log(`   Angle: ${brief.angle}`);
  console.log(`   Source: ${brief.sourcePublication}`);

  // Wait 65 seconds to clear the 1-minute rate limit window before Writer call
  console.log("⏳ Waiting 65 seconds for rate limit window to reset...");
  await new Promise((resolve) => setTimeout(resolve, 65000));

  // 2. Writer — pass only the brief, not the full scout response
  console.log("✍️  WRITER AGENT: Generating article...");
  const articleBody = await callClaude(
    WRITER_SYSTEM,
    `Write a full satirical article for govment.org based on this brief:\n${JSON.stringify(brief, null, 2)}`
  );
  console.log("✅ WRITER: Article generated.");

  // 3. Build HTML page
  const html = buildArticlePage(brief, articleBody);
  const outputPath = path.join(OUTPUT_DIR, `${brief.slug}.html`);
  fs.writeFileSync(outputPath, html, "utf8");
  console.log(`✅ PUBLISHER: Written to ${brief.slug}.html`);

  // 4. Write image prompt to a file for optional GPT image step later
  const imagePromptPath = path.join(OUTPUT_DIR, "scripts", "last-image-prompt.json");
  fs.writeFileSync(
    imagePromptPath,
    JSON.stringify(
      {
        filename: `${brief.imageFilename}.png`,
        prompt: brief.imagePrompt,
        article: brief.slug,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`📸 IMAGE PROMPT saved to scripts/last-image-prompt.json`);
  console.log(`   Filename will be: ${brief.imageFilename}.png`);

  // 5. Log summary for commit message
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("PIPELINE COMPLETE");
  console.log(`Article: ${brief.slug}.html`);
  console.log(`Category: ${brief.category}`);
  console.log(`Source: ${brief.sourceUrl}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

run().catch((err) => {
  console.error("❌ Pipeline error:", err.message);
  process.exit(1);
});
