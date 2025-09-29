// functions/comparison/[...slug].js
import matter from 'gray-matter';             // parse frontmatter
import { marked } from 'marked';              // markdown -> HTML
// Note: When deploying to Cloudflare Pages Functions you must bundle these deps.

export async function onRequest(context) {
  const { request, params, env } = context;
  const slug = Array.isArray(params.slug) ? params.slug.join('/') : params.slug;

  try {
    // handle direct .md requests -> canonical
    if (slug && slug.endsWith('.md')) {
      const clean = slug.replace(/\.md$/, '');
      return Response.redirect(`${new URL(request.url).origin}/comparison/${clean}`, 301);
    }

    const raw = await fetchComparisonContent(slug, env.GITHUB_TOKEN);
    if (!raw) return renderError('Comparison not found', 'The requested comparison could not be found.');

    const { data: frontmatter, content: markdown } = matter(raw);

    // Render markdown to HTML with marked
    const htmlContent = renderMarkdownToHTML(markdown, frontmatter);

    // Find winners (simple heuristic: read structured section or fallback to frontmatter)
    const winners = extractWinners(markdown, frontmatter);

    // Fetch related (latest 8) comparisons
    const related = await fetchLatestRelatedComparisons(slug, env.GITHUB_TOKEN, 8);

    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    const schema = generateSchema(frontmatter, slug, canonicalUrl, winners);

    const pageHtml = buildPageHtml(frontmatter, htmlContent, winners, related, schema, canonicalUrl, slug);

    // 6 months = 15552000 seconds
    const headers = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=15552000, immutable',
      // Surrogate-Control is honored by some CDNs including Cloudflare for edge caching
      'Surrogate-Control': 'max-age=15552000, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    };

    return new Response(pageHtml, { headers });

  } catch (err) {
    console.error('Error rendering comparison page:', err);
    return renderError('Server Error', 'An error occurred while loading the comparison.');
  }
}

/* -------------------------
   Helper: fetch comparison markdown from GitHub
   ------------------------- */
async function fetchComparisonContent(slug, token) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const path = `content/comparisons/${slug}.md`;
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;

  try {
    const resp = await fetch(url, {
      headers: token ? { Authorization: `token ${token}`, 'User-Agent': 'Review-Index-App' } : { 'User-Agent': 'Review-Index-App' }
    });
    if (resp.status === 200) {
      // GitHub raw endpoint returns base64 in this endpoint; but requesting Accept raw is simpler:
      // but to keep robust, use .text() if API returns raw; otherwise decode base64.
      const text = await resp.text();
      // If we got JSON, it might be the file object with content base64 -> try parse
      try {
        const obj = JSON.parse(text);
        if (obj && obj.content) {
          return Buffer.from(obj.content, 'base64').toString('utf-8');
        }
      } catch (e) {
        // not JSON -> it's raw markdown already
        return text;
      }
    }
    return null;
  } catch (e) {
    console.error('fetchComparisonContent error', e);
    return null;
  }
}

/* -------------------------
   Helper: fetch latest related comparisons (by frontmatter.date)
   - returns up to `limit` items excluding `currentSlug`
   ------------------------- */
async function fetchLatestRelatedComparisons(currentSlug, token, limit = 8) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const listUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/comparisons`;

  try {
    const resp = await fetch(listUrl, {
      headers: token ? { Authorization: `token ${token}`, 'User-Agent': 'Review-Index-App' } : { 'User-Agent': 'Review-Index-App' }
    });
    if (resp.status !== 200) return [];

    const files = await resp.json();
    // Filter .md files
    const mdFiles = files.filter(f => f.name && f.name.endsWith('.md'));

    // Parallel fetch frontmatter for each file (bounded map)
    const parsed = await Promise.all(mdFiles.map(async f => {
      try {
        const r = await fetch(f.download_url);
        if (r.status !== 200) return null;
        const txt = await r.text();
        const { data } = matter(txt);
        return {
          slug: f.name.replace('.md', ''),
          title: data.title || '',
          description: data.description || '',
          date: data.date ? new Date(data.date).toISOString() : null,
          products: data.comparison_products || [],
          categories: data.categories || []
        };
      } catch (err) {
        return null;
      }
    }));

    const filtered = parsed.filter(p => p && p.slug !== currentSlug);

    // Sort by date desc (newest first), fallback alphabetical
    filtered.sort((a, b) => {
      if (a.date && b.date) return new Date(b.date) - new Date(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.title.localeCompare(b.title);
    });

    return filtered.slice(0, limit);
  } catch (e) {
    console.error('fetchLatestRelatedComparisons error', e);
    return [];
  }
}

/* -------------------------
   Markdown rendering with marked + light sanitization
   ------------------------- */
function renderMarkdownToHTML(markdown, frontmatter) {
  // Configure marked
  marked.setOptions({
    gfm: true,
    breaks: false,
    smartLists: true,
    mangle: false
  });

  // Custom renderer to add classes / lazy load images and convert affiliate link patterns
  const renderer = new marked.Renderer();

  renderer.image = (href, title, text) => {
    // Ensure responsivity + lazy loading + decoding
    const escapedAlt = escapeHtml(text || '');
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(href)}" alt="${escapedAlt}" class="content-image" loading="lazy" decoding="async"${t}>`;
  };

  renderer.link = (href, title, text) => {
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    // If link has an affiliate hint in the markdown (we'll render as affiliate button server-side if frontmatter or link pattern dictates)
    // Keep external links secure
    const target = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(href)}"${target}${t}>${text}</a>`;
  };

  // Use the renderer
  const rawHtml = marked.parse(markdown, { renderer });

  // Very small sanitizer: allow-list tags we expect and strip scripts
  return sanitizeHtml(rawHtml);
}

/* -------------------------
   Simple sanitize function (allow-list)
   - purpose: remove <script> tags and attributes that could be dangerous.
   - For production, replace with a well-tested sanitizer like `sanitize-html`.
   ------------------------- */
function sanitizeHtml(dirty) {
  // Remove <script> ... </script>
  let clean = dirty.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  // Remove on* attributes (onclick, onerror)
  clean = clean.replace(/ on\w+="[^"]*"/gi, '');
  clean = clean.replace(/ on\w+='[^']*'/gi, '');
  // Allow iframes but only from youtube/embed or youtu.be
  // For simplicity: strip all iframes that aren't youtube/embed
  clean = clean.replace(/<iframe[\s\S]*?src=["']([^"']+)["'][\s\S]*?>[\s\S]*?<\/iframe>/gi, (m, src) => {
    if (/youtube\.com\/embed\/|youtu\.be\//.test(src)) {
      // keep only safe attributes
      const srcEsc = escapeHtml(src);
      return `<iframe width="100%" height="400" src="${srcEsc}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    }
    return ''; // strip other iframes
  });
  return clean;
}

/* -------------------------
   Extract winners from markdown OR frontmatter
   ------------------------- */
function extractWinners(markdown, frontmatter) {
  const winners = { overall: '', budget: '', performance: '' };

  // Quick regex-based extraction: look for "Overall Winner:" or the emoji lines
  const overallMatch = markdown.match(/Overall Winner[:\s]*([^\n*]+)/i) || markdown.match(/🏆\s*\*\*Overall Winner\:\*\*\s*([^\n*]+)/i);
  if (overallMatch) winners.overall = overallMatch[1].trim();

  const budgetMatch = markdown.match(/Best Value[:\s]*([^\n*]+)/i) || markdown.match(/💰\s*\*\*Best Value\:\*\*\s*([^\n*]+)/i);
  if (budgetMatch) winners.budget = budgetMatch[1].trim();

  const perfMatch = markdown.match(/Performance King[:\s]*([^\n*]+)/i) || markdown.match(/⚡\s*\*\*Performance King\:\*\*\s*([^\n*]+)/i);
  if (perfMatch) winners.performance = perfMatch[1].trim();

  // Fallback to frontmatter.custom winners if present
  if (frontmatter?.winners) {
    winners.overall = winners.overall || frontmatter.winners.overall || '';
    winners.budget = winners.budget || frontmatter.winners.budget || '';
    winners.performance = winners.performance || frontmatter.winners.performance || '';
  }

  return winners;
}

/* -------------------------
   JSON-LD generator for SEO (Product comparison + ItemList)
   ------------------------- */
function generateSchema(frontmatter, slug, canonicalUrl, winners) {
  const products = frontmatter.comparison_products || [];
  const datePublished = frontmatter.date ? new Date(frontmatter.date).toISOString() : new Date().toISOString();

  const itemListElements = products.map((p, idx) => ({
    "@type": "ListItem",
    "position": idx + 1,
    "name": p
  }));

  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": frontmatter.title || slug,
    "description": frontmatter.description || '',
    "image": frontmatter.featured_image || '',
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": canonicalUrl
    },
    "review": {
      "@type": "Review",
      "author": { "@type": "Organization", "name": "ReviewIndex" }
    },
    "potentialAction": [
      {
        "@type": "ReadAction",
        "target": canonicalUrl
      }
    ],
    "itemListElement": itemListElements,
    "datePublished": datePublished
  };

  // Add winners as potentialProperties
  if (winners.overall) schema.award = winners.overall;
  return JSON.stringify(schema, null, 2);
}

/* -------------------------
   Build full HTML page (head + body)
   ------------------------- */
function buildPageHtml(frontmatter, htmlContent, winners, related, schemaMarkup, canonicalUrl, slug) {
  const title = escapeHtml(frontmatter.title || formatSlug(slug));
  const description = escapeHtml(frontmatter.description || `Compare ${ (frontmatter.comparison_products||[]).join(' vs ') } - in-depth analysis and buying guide`);
  const featuredImage = escapeHtml(frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-image.jpg');

  // Minimal CSS: keep your existing CSS (omitted here for brevity) — in practice import or inline your CSS.
  const css = `/* keep your existing site CSS here — identical to prior file */`;

  // Related HTML
  const relatedHtml = related.length ? `
    <section class="related-section" aria-labelledby="related-title">
      <h2 class="section-title" id="related-title">🔗 Related Comparisons</h2>
      <div class="related-grid">
        ${related.map(r => `
          <a href="/comparison/${r.slug}" class="related-card" aria-label="Read comparison: ${escapeHtml(r.title)}">
            <h4>${escapeHtml(r.title)}</h4>
            <p style="color: #64748b; font-size:0.9rem;">${escapeHtml(r.description || '')}</p>
            ${r.products && r.products.length ? `<div class="related-products">${r.products.map((p,i)=> `<span class="related-badge">${escapeHtml(p)}</span>${ i < r.products.length-1 ? '<span class="related-vs">vs</span>' : ''}`).join('')}</div>` : ''}
          </a>
        `).join('')}
      </div>
    </section>
  ` : '';

  // winners snippet
  const winnersHtml = `
    <div class="summary-cards">
      <div class="summary-card ${winners.overall ? 'winner' : ''}">
        <h3>🏆 Overall Winner</h3>
        <p style="font-size:1.1rem; font-weight:600; color:#10b981;">${escapeHtml(winners.overall || (frontmatter.comparison_products||[])[0] || 'Check Comparison')}</p>
      </div>
      <div class="summary-card ${winners.budget ? 'winner' : ''}">
        <h3>💰 Best Value</h3>
        <p style="font-size:1.1rem; font-weight:600; color:#f59e0b;">${escapeHtml(winners.budget || (frontmatter.comparison_products||[])[1] || '')}</p>
      </div>
      <div class="summary-card ${winners.performance ? 'winner' : ''}">
        <h3>⚡ Performance</h3>
        <p style="font-size:1.1rem; font-weight:600; color:#3b82f6;">${escapeHtml(winners.performance || '')}</p>
      </div>
    </div>
  `;

  return `
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} - ReviewIndex</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${canonicalUrl}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${featuredImage}">
    <meta name="twitter:card" content="summary_large_image">
    <script type="application/ld+json">${schemaMarkup}</script>
    <style>${css}</style>
  </head>
  <body>
    <div class="container">
      <header class="header" role="banner">
        <h1>${title}</h1>
        ${frontmatter.description ? `<p class="description">${escapeHtml(frontmatter.description)}</p>` : ''}
      </header>

      <main role="main">
        ${winnersHtml}
        <div class="markdown-content">
          ${htmlContent}
        </div>

        ${relatedHtml}

        <div style="text-align:center; margin:2rem 0;">
          <a href="/comparisons" class="back-link">← View All Comparisons</a>
        </div>
      </main>

      <footer class="footer" role="contentinfo">
        <p>© ${new Date().getFullYear()} ReviewIndex. All comparisons are independently researched.</p>
        <p>Last updated: ${frontmatter.date ? new Date(frontmatter.date).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : 'Recently'}</p>
      </footer>
    </div>

    <script>
      // ensure images lazy load just in case
      document.addEventListener('DOMContentLoaded', function(){
        document.querySelectorAll('.markdown-content img, .product-image').forEach(i=>{ i.loading='lazy'; i.decoding='async'; });
      });
    </script>
  </body>
  </html>
  `;
}

/* -------------------------
   Utilities
   ------------------------- */
function escapeHtml(unsafe) {
  if (!unsafe && unsafe !== 0) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatSlug(slug) {
  return slug ? slug.split('-').map(s => s[0]?.toUpperCase() + s.slice(1)).join(' ') : '';
}

function renderError(title, message) {
  const html = `<!doctype html><html><head><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/comparisons">Back</a></p></body></html>`;
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
