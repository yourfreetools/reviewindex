// functions/comparison/[...slug].js
// Production-grade, JS-only Cloudflare Pages Function
// - No external libs
// - Parses frontmatter, renders markdown, fetches related comparisons, outputs SEO-optimized HTML
// - Caches for 6 months

export async function onRequest(context) {
  const { request, params, env } = context;
  const slug = Array.isArray(params.slug) ? params.slug.join("/") : params.slug;

  try {
    // Redirect .md requests to canonical comparison URL
    if (slug && slug.endsWith(".md")) {
      const clean = slug.replace(/\.md$/, "");
      return Response.redirect(`${new URL(request.url).origin}/comparison/${clean}`, 301);
    }

    // Fetch the comparison markdown
    const raw = await fetchComparisonContent(slug, env.GITHUB_TOKEN);
    if (!raw) return renderErrorPage("Not found", "Comparison not found");

    // Parse frontmatter and markdown body
    const { frontmatter, body } = parseFrontmatter(raw);

    // Render markdown to HTML (sanitized, supports tables, lists, headings, images, iframes YT)
    const htmlContent = renderMarkdownToHtml(body);

    // Winners heuristics
    const winners = extractWinners(body, frontmatter);

    // Get latest 8 comparisons and compute related (by category), show up to 2 related
    const latest = await fetchLatestComparisons(slug, env.GITHUB_TOKEN, 8);
    const related = computeRelated(latest, frontmatter.categories || [], 2);

    // Build JSON-LD schema (Product, ItemList, BreadcrumbList)
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    const jsonld = buildJsonLd(frontmatter, slug, canonicalUrl, winners);

    // Build full HTML page
    const html = buildFullPage({
      frontmatter,
      htmlContent,
      winners,
      related,
      jsonld,
      canonicalUrl,
      slug
    });

    // Return with 6-month cache (Cloudflare & browsers)
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=15552000, immutable",
        "Surrogate-Control": "max-age=15552000, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY"
      }
    });

  } catch (err) {
    console.error("render error", err);
    return renderErrorPage("Server error", "An error occurred while rendering this comparison.");
  }
}

/* ============================
   GitHub helpers (no deps)
   ============================ */
async function fetchComparisonContent(slug, token) {
  const REPO_OWNER = "yourfreetools";
  const REPO_NAME = "reviewindex";
  const path = `content/comparisons/${slug}.md`;
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;

  const headers = { "User-Agent": "ReviewIndex-App" };
  if (token) headers.Authorization = `token ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) return null;

  // GitHub returns JSON with base64 content
  const obj = await res.json();
  if (!obj || !obj.content) return null;

  // atob is available in Workers for base64 decode
  try {
    // Remove newlines if any
    const normalized = obj.content.replace(/\n/g, "");
    return atob(normalized);
  } catch (e) {
    // fallback
    return Buffer ? Buffer.from(obj.content, "base64").toString("utf8") : null;
  }
}

async function fetchLatestComparisons(currentSlug, token, limit = 8) {
  const REPO_OWNER = "yourfreetools";
  const REPO_NAME = "reviewindex";
  const listUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/comparisons`;
  const headers = { "User-Agent": "ReviewIndex-App" };
  if (token) headers.Authorization = `token ${token}`;

  const res = await fetch(listUrl, { headers });
  if (!res.ok) return [];

  const files = await res.json();
  const mdFiles = files.filter(f => f && f.name && f.name.endsWith(".md"));

  // Fetch file download content (frontmatter) in parallel (bounded)
  const promises = mdFiles.map(async f => {
    try {
      const r = await fetch(f.download_url);
      if (!r.ok) return null;
      const txt = await r.text();
      const { frontmatter } = parseFrontmatter(txt);
      return {
        slug: f.name.replace(/\.md$/, ""),
        title: frontmatter.title || "",
        description: frontmatter.description || "",
        date: frontmatter.date ? new Date(frontmatter.date).toISOString() : null,
        categories: frontmatter.categories || [],
        products: frontmatter.comparison_products || []
      };
    } catch (e) {
      return null;
    }
  });

  const parsed = (await Promise.all(promises)).filter(Boolean);

  // Sort newest first by date, then by title
  parsed.sort((a, b) => {
    if (a.date && b.date) return new Date(b.date) - new Date(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.title.localeCompare(b.title);
  });

  // Remove current slug
  const filtered = parsed.filter(p => p.slug !== currentSlug);
  return filtered.slice(0, limit);
}

/* ============================
   Related computations
   - include only items that share at least 1 category
   - exclude generic categories: review(s), comparison(s)
   ============================ */
function computeRelated(latestList, categories, maxRelated = 2) {
  if (!categories) return [];
  const skip = new Set(["review", "reviews", "comparison", "comparisons"]);
  const cats = (Array.isArray(categories) ? categories : [categories])
    .map(c => String(c || "").toLowerCase().trim())
    .filter(c => c && !skip.has(c));

  if (!cats.length) return [];

  const related = latestList.filter(item => {
    if (!item.categories || !item.categories.length) return false;
    const itemCats = item.categories.map(c => String(c).toLowerCase().trim());
    return itemCats.some(ic => cats.includes(ic));
  });

  return related.slice(0, maxRelated);
}

/* ============================
   Frontmatter parser (small, robust)
   - supports simple YAML: key: "value" or key: [a, b]
   - returns {frontmatter, body}
   ============================ */
function parseFrontmatter(raw) {
  const result = { frontmatter: {}, body: raw };

  if (!raw || typeof raw !== "string") return result;

  if (raw.startsWith("---")) {
    const endIndex = raw.indexOf("\n---", 3);
    // allow ending '---' with newline or alone
    const altEnd = raw.indexOf("\n...\n", 3);
    let fmEnd = endIndex;
    if (fmEnd === -1 && altEnd !== -1) fmEnd = altEnd;
    if (fmEnd !== -1) {
      const fmBlock = raw.slice(3, fmEnd).trim();
      const bodyStart = fmEnd + (raw[fmEnd] === "\n" ? 4 : 3);
      result.body = raw.slice(bodyStart).trim();

      // parse lines of YAML-like "key: value"
      const lines = fmBlock.split(/\r?\n/).filter(Boolean);
      lines.forEach(line => {
        const colon = line.indexOf(":");
        if (colon === -1) return;
        const key = line.slice(0, colon).trim();
        let value = line.slice(colon + 1).trim();

        // arrays in form: [a, b, "c"]
        if (value.startsWith("[") && value.endsWith("]")) {
          let inner = value.slice(1, -1).trim();
          // split on commas not inside quotes (simple)
          const items = inner.length ? inner.split(",").map(s => s.trim().replace(/^['"]|['"]$/g, "")) : [];
          result.frontmatter[key] = items;
        } else {
          // strip surrounding quotes
          value = value.replace(/^['"]|['"]$/g, "");
          // try to parse boolean or number
          if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
            result.frontmatter[key] = value; // keep ISO date string
          } else if (value === "true" || value === "false") {
            result.frontmatter[key] = value === "true";
          } else if (!isNaN(Number(value)) && value !== "") {
            result.frontmatter[key] = Number(value);
          } else {
            result.frontmatter[key] = value;
          }
        }
      });
    }
  }
  return result;
}

/* ============================
   Markdown renderer (improved)
   - supports: headings, paragraphs, code blocks, inline code, bold, italic
   - lists (ordered/unordered), nested lists (limited), tables (basic), images, links
   - blockquotes
   - preserves YouTube iframes (safe allow)
   - final output sanitized (strip scripts, on* attributes)
   ============================ */
function renderMarkdownToHtml(md) {
  if (!md) return "";

  // Normalize newlines
  let src = md.replace(/\r\n/g, "\n");

  // Preserve fenced code blocks
  const codeBlocks = [];
  src = src.replace(/```([a-zA-Z0-9-_+]*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push({ lang: lang || "", code: escapeHtml(code) });
    return `\n\n${placeholder}\n\n`;
  });

  // Preserve inline HTML iframes (youtube) — keep them, remove others later
  const iframePlaceholders = [];
  src = src.replace(/<iframe[\s\S]*?<\/iframe>/gi, (m) => {
    iframePlaceholders.push(m);
    return `@@IFRAME${iframePlaceholders.length - 1}@@`;
  });

  // Convert headings
  src = src.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
  src = src.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
  src = src.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
  src = src.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  src = src.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  src = src.replace(/^# (.*)$/gm, '<h1>$1</h1>');

  // Horizontal rules
  src = src.replace(/^(?:\*\*\*|- - -|---)$/gm, '<hr/>');

  // Blockquotes
  src = src.replace(/(^|\n)> (.*)/g, '$1<blockquote>$2</blockquote>');

  // Tables: capture groups of contiguous table lines starting with |
  src = src.replace(/((^\|.+\|$\n?)+)/gm, (m) => {
    const rows = m.trim().split(/\n/).map(r => r.trim().replace(/^\||\|$/g, ""));
    const cols = rows.map(r => r.split("|").map(c => c.trim()));
    const thead = cols.length > 1 && cols[1].every(c => /^-+$/.test(c.replace(/:/g, "").replace(/^-+|-+$/g,""))) ? cols[0] : null;
    let start = 0;
    if (thead) start = 2; // header + separator
    let out = "<div class=\"table-wrap\"><table class=\"md-table\">";
    if (thead) {
      out += "<thead><tr>" + thead.map(h => `<th>${inlineFormat(h)}</th>`).join("") + "</tr></thead>";
    }
    out += "<tbody>";
    for (let i = start; i < cols.length; i++) {
      const cells = cols[i];
      out += "<tr>" + cells.map(c => `<td>${inlineFormat(c)}</td>`).join("") + "</tr>";
    }
    out += "</tbody></table></div>";
    return out;
  });

  // Lists - handle bullets and ordered lists (simple)
  // Convert lines to <li> first then wrap contiguous <li> groups with ul/ol
  src = src.replace(/^\s*[-*+] (.+)$/gm, '<li>$1</li>');
  src = src.replace(/^\s*\d+\.\s+(.+)$/gm, '<li class="ol">$1</li>');

  // Wrap consecutive <li> into lists
  src = src.replace(/(?:<li>[\s\S]*?<\/li>)(?:\n?<li>[\s\S]*?<\/li>)*/g, (m) => {
    const lines = m.split(/\n/).filter(Boolean);
    const isOrdered = lines.some(l => l.includes('class="ol"'));
    if (isOrdered) {
      return '<ol>' + lines.map(l => l.replace(/<li class="ol">([\s\S]*?)<\/li>/, '<li>$1</li>')).join("") + '</ol>';
    } else {
      return '<ul>' + lines.join("") + '</ul>';
    }
  });

  // Paragraphs: split by double newlines and wrap by <p> when not already a block element
  const blocks = src.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  const wrapped = blocks.map(block => {
    // If block already begins with block-level tag, return as-is
    if (/^<(h\d|ul|ol|li|table|div|blockquote|pre|img|iframe|hr|p)/i.test(block)) return block;
    return `<p>${inlineFormat(block)}</p>`;
  }).join("\n\n");

  let out = wrapped;

  // Restore code blocks
  out = out.replace(/@@CODEBLOCK(\d+)@@/g, (_, idx) => {
    const cb = codeBlocks[Number(idx)];
    return `<pre class="code-block"><code${cb.lang ? ` data-lang="${escapeHtml(cb.lang)}"` : ""}>${cb.code}</code></pre>`;
  });

  // Restore iframes but sanitize (only allow YouTube embed)
  out = out.replace(/@@IFRAME(\d+)@@/g, (_, idx) => {
    const raw = iframePlaceholders[Number(idx)] || "";
    // extract src
    const m = raw.match(/src=["']([^"']+)["']/i);
    if (!m) return ""; // drop if no src
    const srcUrl = m[1];
    // allow youtube only
    if (/youtube\.com\/embed\/|youtu\.be\//i.test(srcUrl)) {
      // keep only safe attributes
      return `<div class="video-wrap" aria-hidden="false"><iframe src="${escapeHtml(srcUrl)}" frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
    }
    return "";
  });

  // Final sanitize: remove <script> and on* attributes
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/\son\w+="[^"]*"/gi, "");
  out = out.replace(/\son\w+='[^']*'/gi, "");

  return out;
}

/* Inline formatting for text fragments (bold, italic, links, images, inline code) */
function inlineFormat(txt) {
  if (!txt) return "";
  let s = txt;

  // Images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
  });

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const safe = escapeHtml(url);
    const rel = /^https?:\/\//i.test(url) ? ' rel="noopener noreferrer" target="_blank"' : "";
    return `<a href="${safe}"${rel}>${escapeHtml(text)}</a>`;
  });

  // Inline code `...`
  s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);

  // Bold **...**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => `<strong>${escapeHtml(t)}</strong>`);

  // Italic *...*
  s = s.replace(/\*([^*]+)\*/g, (_, t) => `<em>${escapeHtml(t)}</em>`);

  return s;
}

/* ============================
   Winners extraction (robust)
   ============================ */
function extractWinners(body, frontmatter) {
  const result = { overall: "", budget: "", performance: "" };

  // Heuristic: lines with emojis or explicit "Overall Winner:" etc
  const lines = body.split(/\r?\n/).map(l => l.trim());
  for (const line of lines) {
    if (/overall winner[:\-\s]/i.test(line) || /🏆/.test(line)) {
      const m = line.match(/(?:Overall Winner[:\s-]*)\s*(.+)/i) || line.match(/🏆\s*(.+)/);
      if (m && m[1]) result.overall = stripMdMarkup(m[1]);
    }
    if (/best value[:\-\s]/i.test(line) || /💰/.test(line)) {
      const m = line.match(/(?:Best Value[:\s-]*)\s*(.+)/i) || line.match(/💰\s*(.+)/);
      if (m && m[1]) result.budget = stripMdMarkup(m[1]);
    }
    if (/performance king[:\-\s]/i.test(line) || /⚡/.test(line)) {
      const m = line.match(/(?:Performance King[:\s-]*)\s*(.+)/i) || line.match(/⚡\s*(.+)/);
      if (m && m[1]) result.performance = stripMdMarkup(m[1]);
    }
  }

  // Fallback to frontmatter.winners if present
  if (frontmatter && frontmatter.winners) {
    result.overall = result.overall || frontmatter.winners.overall || "";
    result.budget = result.budget || frontmatter.winners.budget || "";
    result.performance = result.performance || frontmatter.winners.performance || "";
  }

  return result;
}

function stripMdMarkup(text) {
  return text.replace(/[*_`#\[\]]/g, "").trim();
}

/* ============================
   JSON-LD (Product + ItemList + BreadcrumbList)
   ============================ */
function buildJsonLd(frontmatter, slug, canonicalUrl, winners) {
  const products = (frontmatter.comparison_products || []).map((p, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: p
  }));

  const pageTitle = frontmatter.title || (slug ? slug.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" ") : "Comparison");

  const productSchema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "name": pageTitle,
        "description": frontmatter.description || "",
        "image": frontmatter.featured_image || "",
        "award": winners.overall || ""
      },
      {
        "@type": "ItemList",
        "itemListElement": products
      },
      {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://reviewindex.pages.dev/" },
          { "@type": "ListItem", "position": 2, "name": "Comparisons", "item": "https://reviewindex.pages.dev/comparisons" },
          { "@type": "ListItem", "position": 3, "name": pageTitle, "item": canonicalUrl }
        ]
      }
    ]
  };

  return JSON.stringify(productSchema, null, 2);
}

/* ============================
   Page builder (Inline critical CSS, preconnects, accessible markup)
   ============================ */
function buildFullPage({ frontmatter, htmlContent, winners, related, jsonld, canonicalUrl, slug }) {
  const title = frontmatter.title || formatTitleFromSlug(slug);
  const description = frontmatter.description || generateDescription(frontmatter);
  const image = frontmatter.featured_image || "https://reviewindex.pages.dev/default-comparison-image.jpg";
  const published = frontmatter.date ? new Date(frontmatter.date).toISOString() : new Date().toISOString();

  // Inline critical CSS (pro, minimal)
  const css = `
:root{--bg:#f8fafc;--card:#fff;--muted:#64748b;--accent:#2563eb;--success:#10b981;--danger:#ef4444;--radius:12px;}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial;color:#0f172a;background:var(--bg);line-height:1.6}
.container{max-width:1100px;margin:0 auto;padding:20px}
header.site-header{display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px;background:linear-gradient(180deg,#ffffff,#fbfdff);border-radius:16px;box-shadow:0 6px 18px rgba(2,6,23,0.06);border:1px solid #e6eefb}
h1.page-title{font-size:clamp(1.25rem,2.4vw,1.9rem);margin:0;text-align:center}
.meta-desc{color:var(--muted);max-width:900px;text-align:center}
.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:18px}
.summary-card{background:var(--card);padding:16px;border-radius:12px;box-shadow:0 4px 14px rgba(2,6,23,0.04);border:1px solid rgba(2,6,23,0.03);text-align:center}
.summary-card.winner{outline:3px solid rgba(37,99,235,0.08);box-shadow:0 8px 30px rgba(37,99,235,0.06)}
.main-article{display:grid;grid-template-columns:1fr;gap:20px;margin-top:20px}
.card{background:var(--card);padding:18px;border-radius:12px;border:1px solid rgba(2,6,23,0.04);box-shadow:0 6px 18px rgba(2,6,23,0.03)}
.markdown-content img{max-width:100%;height:auto;border-radius:8px;display:block;margin:12px 0}
.md-table{width:100%;border-collapse:collapse;margin:12px 0;font-size:0.95rem}
.md-table th,.md-table td{border:1px solid #eef2f7;padding:10px;text-align:left}
.table-wrap{overflow:auto;border-radius:8px}
.video-wrap{position:relative;padding-top:56.25%;overflow:hidden;border-radius:8px}
.video-wrap iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}
.related-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.related-card{display:block;text-decoration:none;color:inherit;background:linear-gradient(180deg,#fff,#fbfdff);padding:14px;border-radius:10px;border:1px solid rgba(2,6,23,0.04);box-shadow:0 4px 14px rgba(2,6,23,0.04)}
.related-card h4{margin:0 0 8px 0}
.footer{margin-top:28px;padding:26px;text-align:center;color:var(--muted);font-size:0.95rem}
a.cta{display:inline-block;background:var(--accent);color:white;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600}
@media(min-width:900px){.main-article{grid-template-columns: 2fr 380px;grid-column-gap:20px}}
@media(max-width:600px){.container{padding:14px}.summary-card{padding:12px}}
`;

  // Preconnect for performance (CDN, YouTube)
  const preconnects = `
<link rel="preconnect" href="https://m.media-amazon.com" crossorigin>
<link rel="preconnect" href="https://i.ytimg.com" crossorigin>
<link rel="preconnect" href="https://www.youtube.com" crossorigin>
`;

  // Build related HTML block
  const relatedHtml = (related && related.length)
    ? `<aside class="card">
         <h3 style="margin:0 0 12px 0">🔗 Related Comparisons</h3>
         <div class="related-grid">
           ${related.map(r => `
             <a class="related-card" href="/comparison/${r.slug}" aria-label="Read comparison ${escapeHtml(r.title)}">
               <h4>${escapeHtml(r.title)}</h4>
               <p style="margin:0;color:var(--muted);font-size:0.95rem">${escapeHtml(r.description || "")}</p>
             </a>`).join("")}
         </div>
       </aside>` : "";

  // Final HTML
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(canonicalUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${preconnects}
<script type="application/ld+json">${escapeHtml(jsonld)}</script>
<style>${css}</style>
</head>
<body>
<main class="container" role="main">
  <header class="site-header" role="banner">
    <h1 class="page-title">${escapeHtml(title)}</h1>
    ${description ? `<p class="meta-desc">${escapeHtml(description)}</p>` : ""}
    <div class="summary-grid" role="region" aria-label="Quick verdicts">
      <div class="summary-card ${winners.overall ? "winner" : ""}">
        <h4 style="margin:0">🏆 Overall Winner</h4>
        <p style="margin:.5rem 0 0 0;font-weight:600">${escapeHtml(winners.overall || (frontmatter.comparison_products && frontmatter.comparison_products[0]) || "")}</p>
      </div>
      <div class="summary-card ${winners.budget ? "winner" : ""}">
        <h4 style="margin:0">💰 Best Value</h4>
        <p style="margin:.5rem 0 0 0;font-weight:600">${escapeHtml(winners.budget || (frontmatter.comparison_products && frontmatter.comparison_products[1]) || "")}</p>
      </div>
      <div class="summary-card ${winners.performance ? "winner" : ""}">
        <h4 style="margin:0">⚡ Performance</h4>
        <p style="margin:.5rem 0 0 0;font-weight:600">${escapeHtml(winners.performance || "")}</p>
      </div>
    </div>
  </header>

  <section class="main-article" aria-labelledby="article-title">
    <article class="card" aria-label="Comparison content">
      ${htmlContent}
    </article>

    ${relatedHtml}
  </section>

  <footer class="footer" role="contentinfo">
    <div>© ${new Date().getFullYear()} ReviewIndex</div>
    ${frontmatter.date ? `<div>Last updated: ${escapeHtml(formatDate(frontmatter.date))}</div>` : ""}
  </footer>
</main>
</body>
</html>`;
}

/* ============================
   Utilities
   ============================ */
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch (e) { return iso; }
}
function formatTitleFromSlug(slug) {
  if (!slug) return "Comparison";
  return slug.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function generateDescription(fm) {
  if (fm && fm.description) return fm.description;
  if (fm && fm.comparison_products && fm.comparison_products.length) {
    return `Compare ${fm.comparison_products.join(" vs ")} — features, pros & cons, and recommendations.`;
  }
  return "Side-by-side comparison and buying guide.";
}
function escapeHtmlAttr(s) { return escapeHtml(s).replace(/"/g,'&quot;'); }
function escapeHtmlSafe(s){ return escapeHtml(s); }
function escapeHtmlLiked(s){ return escapeHtml(s); }
function escapeHtmlAny(s){ return escapeHtml(s); }

// small wrapper to keep naming consistent
function escapeHtml(value) { return escapeHtmlSafe(value); }

// Strip markdown emphasis for short labels
function stripMdMarkup(s) { return (s || "").replace(/[*_`#\[]/g, "").trim(); }

/* Final small compatibility: ensure functions referenced exist */
function renderErrorPage(title, message) {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui, sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#1f2937} .box{background:#fff;padding:24px;border-radius:12px;box-shadow:0 8px 24px rgba(2,6,23,0.06);max-width:560px;text-align:center}</style></head><body><div class="box"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
  return new Response(body, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
