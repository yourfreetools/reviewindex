// functions/review/[...slug].js
// Full, self-contained file — drop in and test.
// Make sure env.GITHUB_TOKEN has repo contents permission.

export async function onRequest(context) {
  const { request, params, env } = context;
  const slug = params.slug;

  try {
    // redirect raw .md requests to pretty URL
    if (typeof slug === 'string' && slug.endsWith('.md')) {
      const clean = slug.replace('.md', '');
      return Response.redirect(`${new URL(request.url).origin}/review/${clean}`, 301);
    }

    // 1) fetch markdown file
    const rawMd = await fetchPostContent(slug, env.GITHUB_TOKEN);
    if (!rawMd) return renderErrorPage('Review not found', 'The requested review could not be found.');

    // 2) parse frontmatter and body
    let { frontmatter, content } = parseMarkdown(rawMd);
    frontmatter = frontmatter || {};

    // 3) determine related posts (either from frontmatter or compute & save)
    let relatedPosts = [];
    if (frontmatter.checked) {
      // already checked — use saved values (defensive)
      const saved = frontmatter.related || [];
      if (Array.isArray(saved)) {
        relatedPosts = saved.map(r => ({
          slug: r.slug,
          title: r.title || formatSlug(r.slug),
          description: r.description || '',
          image: r.image || '/default-thumbnail.jpg',
          categories: r.categories || []
        }));
      }
    } else {
      // first view — compute related posts
      const fresh = await findRelatedPostsFromGitHub(frontmatter, slug, env.GITHUB_TOKEN);
      relatedPosts = (fresh || []).slice(0, 4); // now up to 4 related posts

      // save full objects into frontmatter and mark checked: true
      frontmatter.related = relatedPosts.map(p => ({
        slug: p.slug,
        title: p.title,
        description: p.description || '',
        image: p.image || '/default-thumbnail.jpg',
        categories: p.categories || []
      }));
      frontmatter.checked = true;

      // attempt write back to GitHub (do not block render on failure)
      try {
        await updateMarkdownFileWithRelated(slug, rawMd, frontmatter, env.GITHUB_TOKEN);
        console.log(`✅ Wrote related posts into ${slug}.md`);
      } catch (err) {
        console.error('Failed to write related posts to GitHub:', err);
      }
    }

    // 4) render page
    const htmlContent = convertMarkdownToHTML(content);
    const fullHtml = await renderPostPage(frontmatter, htmlContent, slug, request.url, relatedPosts);

    return new Response(fullHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      }
    });

  } catch (err) {
    console.error('Unhandled error in onRequest:', err);
    return renderErrorPage('Server Error', 'An error occurred while loading the review.');
  }
}

// (rest of file unchanged...)



// -------------------- GitHub file helpers --------------------

async function fetchPostContent(slug, githubToken) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const filePath = `content/reviews/${slug}.md`;
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${githubToken}`,
        'User-Agent': 'Review-Index-App',
        Accept: 'application/vnd.github.v3.raw' // raw file content
      }
    });

    if (res.status === 200) {
      return await res.text();
    } else {
      console.error('fetchPostContent status', res.status, await safeText(res));
      return null;
    }
  } catch (err) {
    console.error('fetchPostContent error', err);
    return null;
  }
}

async function updateMarkdownFileWithRelated(slug, oldContent, frontmatter, githubToken) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const filePath = `content/reviews/${slug}.md`;
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

  // build YAML from frontmatter
  const yamlLines = [];
  for (const [key, val] of Object.entries(frontmatter)) {
    if (Array.isArray(val)) {
      // array - either array of scalars or array of objects
      if (val.length > 0 && typeof val[0] === 'object') {
        yamlLines.push(`${key}:`);
        for (const obj of val) {
          yamlLines.push(`  - slug: "${escapeYaml(String(obj.slug || ''))}"`);
          yamlLines.push(`    title: "${escapeYaml(String(obj.title || ''))}"`);
          yamlLines.push(`    description: "${escapeYaml(String(obj.description || ''))}"`);
          yamlLines.push(`    image: "${escapeYaml(String(obj.image || '/default-thumbnail.jpg'))}"`);
          // categories as inline array
          const cats = (obj.categories || []).map(c => `"${escapeYaml(String(c))}"`).join(', ');
          yamlLines.push(`    categories: [${cats}]`);
        }
      } else {
        const inline = val.map(v => `"${escapeYaml(String(v))}"`).join(', ');
        yamlLines.push(`${key}: [${inline}]`);
      }
    } else if (typeof val === 'boolean') {
      yamlLines.push(`${key}: ${val}`);
    } else if (val && typeof val === 'object') {
      yamlLines.push(`${key}:`);
      for (const [k2, v2] of Object.entries(val)) {
        if (Array.isArray(v2)) {
          yamlLines.push(`  ${k2}: [${v2.map(x => `"${escapeYaml(String(x))}"`).join(', ')}]`);
        } else {
          yamlLines.push(`  ${k2}: "${escapeYaml(String(v2))}"`);
        }
      }
    } else {
      yamlLines.push(`${key}: "${escapeYaml(String(val))}"`);
    }
  }

  // get existing file SHA
  const getRes = await fetch(apiUrl, {
    headers: { Authorization: `token ${githubToken}`, 'User-Agent': 'Review-Index-App', Accept: 'application/vnd.github.v3+json' }
  });

  if (!getRes.ok) {
    const txt = await safeText(getRes);
    throw new Error(`Failed to get file metadata: ${getRes.status} ${txt}`);
  }

  const fileMeta = await getRes.json();
  const sha = fileMeta.sha;
  if (!sha) throw new Error('No sha returned for file');

  // take original markdown body (without existing frontmatter)
  const { content: body } = parseMarkdown(oldContent);

  // assemble new md
  const newMd = `---\n${yamlLines.join('\n')}\n---\n\n${body}`;

  // base64 encode (unicode safe)
  const encoded = base64Encode(newMd);

  // put update
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `token ${githubToken}`,
      'User-Agent': 'Review-Index-App',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Add related posts and checked flag to ${slug}.md`,
      content: encoded,
      sha
    })
  });

  if (!putRes.ok) {
    const txt = await safeText(putRes);
    throw new Error(`Failed to update file: ${putRes.status} ${txt}`);
  }

  return true;
}

function base64Encode(str) {
  // unicode-safe base64
  try {
    if (typeof btoa === 'function') {
      return btoa(unescape(encodeURIComponent(str)));
    }
  } catch (_) {}
  // fallback (Node environment)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64');
  }
  throw new Error('No base64 encoder available');
}

async function safeText(res) {
  try { return await res.text(); } catch { return '[no body]'; }
}

function escapeYaml(s) {
  return String(s).replace(/"/g, '\\"');
}


// -------------------- Simple YAML frontmatter parser --------------------
// Supports:
// key: "value"
// key: value
// key: [ "a", "b" ]
// key:
//   - slug: "x"
//     title: "y"
//     description: "z"
//     image: "..."
function parseMarkdown(md) {
  const result = { frontmatter: {}, content: md };
  if (!md || !md.startsWith('---')) return result;

  const endIndex = md.indexOf('---', 3);
  if (endIndex === -1) return result;

  const yamlBlock = md.substring(3, endIndex).trim();
  const body = md.substring(endIndex + 3).trim();

  result.content = body;
  result.frontmatter = parseYAMLBlock(yamlBlock);
  return result;
}

function parseYAMLBlock(yaml) {
  const lines = yaml.split(/\r?\n/);
  const fm = {};
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    // key: rest
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) { i++; continue; }
    const key = m[1];
    let rest = m[2];

    if (rest === '') {
      // block: could be list of objects or nested object
      // peek next non-empty line
      const next = lines[i+1] || '';
      if (/^\s*-\s+/.test(next) || /^\s*-\s*$/.test(next)) {
        // list — parse items
        const arr = [];
        i++;
        while (i < lines.length && /^\s*-\s*/.test(lines[i])) {
          // start of item
          // remove leading '- ' and parse possible inline or multline properties
          let itemLine = lines[i].replace(/^\s*-\s*/, '');
          const item = {};
          if (itemLine && /:/.test(itemLine)) {
            // inline prop like '- slug: "x"'
            const pm = itemLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
            if (pm) item[pm[1]] = parseValue(pm[2]);
            i++;
          } else if (!itemLine) {
            // properties on subsequent indented lines
            i++;
            while (i < lines.length && /^\s{2,}[A-Za-z0-9_-]+:/.test(lines[i])) {
              const prop = lines[i].trim();
              const pm = prop.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
              if (pm) item[pm[1]] = parseValue(pm[2]);
              i++;
            }
          } else {
            // something else inline
            i++;
          }
          // ensure categories arrays are arrays if present as string
          if (item.categories && typeof item.categories === 'string' && item.categories.startsWith('[')) {
            item.categories = parseArrayInline(item.categories);
          }
          arr.push(item);
        }
        fm[key] = arr;
        continue; // already advanced i
      } else {
        // nested object (indented properties)
        const obj = {};
        i++;
        while (i < lines.length && /^\s{2,}[A-Za-z0-9_-]+:/.test(lines[i])) {
          const prop = lines[i].trim();
          const pm = prop.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
          if (pm) obj[pm[1]] = parseValue(pm[2]);
          i++;
        }
        fm[key] = obj;
        continue;
      }
    } else {
      // scalar or inline array or boolean
      if (rest.startsWith('[') && rest.endsWith(']')) {
        fm[key] = parseArrayInline(rest);
      } else {
        fm[key] = parseValue(rest);
      }
    }
    i++;
  }
  return fm;
}

function parseValue(s) {
  if (typeof s !== 'string') return s;
  const t = s.trim();
  if (t === '') return '';
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.substring(1, t.length - 1);
  }
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  return t;
}

function parseArrayInline(text) {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.trim() === '') return [];
  return inner.split(',').map(x => parseValue(x.trim().replace(/^"|"$/g, '')));
}


// -------------------- Related posts discovery --------------------

async function findRelatedPostsFromGitHub(currentFrontmatter, currentSlug, githubToken) {
  try {
    const all = await fetchAllPostsMetadata(githubToken);
    if (!Array.isArray(all) || all.length === 0) return [];

    const currentCats = normalizeCategories(currentFrontmatter.categories || []);
    const related = [];

    for (const p of all) {
      if (!p || !p.slug) continue;
      if (p.slug === currentSlug) continue;
      const pcats = normalizeCategories(p.categories || []);
      const matches = currentCats.filter(c => pcats.includes(c));
      if (matches.length > 0) {
        related.push({
          title: p.title || formatSlug(p.slug),
          slug: p.slug,
          description: p.description || '',
          image: p.image || '/default-thumbnail.jpg',
          categories: matches,
          matchCount: matches.length
        });
      }
    }

    // sort by matchCount desc then return
    related.sort((a, b) => (b.matchCount || 0) - (a.matchCount || 0));
    return related;
  } catch (err) {
    console.error('findRelatedPostsFromGitHub error', err);
    return [];
  }
}

async function fetchAllPostsMetadata(githubToken) {
  const REPO_OWNER = 'yourfreetools';
  const REPO_NAME = 'reviewindex';
  const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/reviews`;

  try {
    const res = await fetch(apiUrl, {
      headers: { Authorization: `token ${githubToken}`, 'User-Agent': 'Review-Index-App', Accept: 'application/vnd.github.v3+json' }
    });
    if (!res.ok) {
      console.error('fetchAllPostsMetadata failed', res.status, await safeText(res));
      return [];
    }
    const files = await res.json();
    const mdFiles = (files || []).filter(f => f.name && f.name.endsWith('.md')).slice(0, 50);
    const posts = [];

    for (const f of mdFiles) {
      try {
        // use download_url if present for raw access
        const rawUrl = f.download_url || `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/content/reviews/${f.name}`;
        const r = await fetch(rawUrl, { headers: { 'User-Agent': 'Review-Index-App' } });
        if (r.ok) {
          const txt = await r.text();
          const { frontmatter } = parseMarkdown(txt);
          posts.push({
            slug: f.name.replace('.md', ''),
            title: frontmatter.title,
            description: frontmatter.description,
            image: frontmatter.image,
            categories: frontmatter.categories
          });
        }
      } catch (err) {
        console.error('Error reading post file', f.name, err);
      }
    }
    return posts;
  } catch (err) {
    console.error('fetchAllPostsMetadata error', err);
    return [];
  }
}


// -------------------- Rendering / helpers (SEO preserved) --------------------

function convertMarkdownToHTML(markdown) {
  if (!markdown) return '';
  let html = markdown
    .replace(/^# (.*$)/gm, '<h2>$1</h2>')
    .replace(/^## (.*$)/gm, '<h3>$1</h3>')
    .replace(/^### (.*$)/gm, '<h4>$1</h4>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy" class="content-image">')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = html.split('\n');
  const processed = [];
  let inList = false;
  let listItems = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList && listItems.length) {
        processed.push(`<ul>${listItems.join('')}</ul>`);
        listItems = [];
        inList = false;
      }
      continue;
    }
    if (/^(- |\* |\d+\.)/.test(line)) {
      if (!inList) inList = true;
      const li = line.replace(/^(- |\* |\d+\.)/, '').trim();
      listItems.push(`<li>${li}</li>`);
    } else {
      if (inList && listItems.length) {
        processed.push(`<ul>${listItems.join('')}</ul>`);
        listItems = [];
        inList = false;
      }
      processed.push(/^<h\d/.test(line) || /^<img/.test(line) || /^<blockquote/.test(line) ? line : `<p>${line}</p>`);
    }
  }
  if (inList && listItems.length) processed.push(`<ul>${listItems.join('')}</ul>`);
  html = processed.join('\n');

  return html
    .replace(/<p><\/p>/g, '')
    .replace(/(<\/h[2-4]>)\s*<p>/g, '$1')
    .replace(/<\/p>\s*(<h[2-4]>)/g, '$1')
    .replace(/<p>(<ul>.*?<\/ul>)<\/p>/g, '$1')
    .replace(/<p>(<blockquote>.*?<\/blockquote>)<\/p>/g, '$1')
    .replace(/<p>(<pre>.*?<\/pre>)<\/p>/gs, '$1');
}

function generateYouTubeEmbed(youtubeUrl, title) {
  if (!youtubeUrl) return '';
  function getYouTubeId(url) {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
  }
  const id = getYouTubeId(youtubeUrl);
  if (!id) return '';
  return `
    <section class="youtube-embed" aria-labelledby="video-title">
      <h3 id="video-title">📺 Video Review</h3>
      <div class="video-wrapper">
        <iframe src="https://www.youtube.com/embed/${escapeHtml(id)}" title="Video review of ${escapeHtml(title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
      </div>
      <p class="video-caption">Watch our detailed video review for a comprehensive overview</p>
    </section>`;
}

function generateSchemaMarkup(frontmatter, slug, url) {
  const rating = parseInt(frontmatter.rating) || 4;
  const productName = (frontmatter.title || formatSlug(slug)).replace(/^Best /, '').replace(/ – Honest Review.*$/, '').trim();
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: productName,
    description: frontmatter.description || 'Comprehensive product review and analysis',
    image: frontmatter.image || '',
    review: {
      "@type": "Review",
      reviewRating: { "@type": "Rating", ratingValue: rating.toString(), bestRating: "5" },
      author: { "@type": "Organization", name: "ReviewIndex" },
      publisher: { "@type": "Organization", name: "ReviewIndex" }
    },
    aggregateRating: { "@type": "AggregateRating", ratingValue: rating.toString(), reviewCount: "1" }
  };
}

function formatSlug(slug) {
  if (!slug) return '';
  return String(slug).split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function escapeHtml(str) {
  if (!str && str !== '') return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// full render function (keeps your SEO + styles + related rendering)
async function renderPostPage(frontmatter, htmlContent, slug, requestUrl, relatedPosts = []) {
  const canonicalUrl = `https://reviewindex.pages.dev/review/${slug}`;
  const schemaMarkup = generateSchemaMarkup(frontmatter, slug, canonicalUrl);
  const socialImage = frontmatter.image || 'https://reviewindex.pages.dev/default-social-image.jpg';
  const youtubeEmbed = frontmatter.youtubeId ? generateYouTubeEmbed(frontmatter.youtubeId, frontmatter.title || formatSlug(slug)) : '';
  const relatedPostsHTML = generateRelatedPostsHTML(relatedPosts, frontmatter.categories);

  // big HTML template preserved (kept concise here)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(frontmatter.title || formatSlug(slug))} - ReviewIndex</title>
<meta name="description" content="${escapeHtml(frontmatter.description || 'Comprehensive product review and analysis')}">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:title" content="${escapeHtml(frontmatter.title || formatSlug(slug))}">
<meta property="og:description" content="${escapeHtml(frontmatter.description || 'Comprehensive product review and analysis')}">
<meta property="og:type" content="article">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:image" content="${escapeHtml(socialImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="ReviewIndex">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(frontmatter.title || formatSlug(slug))}">
<meta name="twitter:description" content="${escapeHtml(frontmatter.description || 'Comprehensive product review and analysis')}">
<meta name="twitter:image" content="${escapeHtml(socialImage)}">
<meta name="twitter:image:alt" content="${escapeHtml(frontmatter.title || formatSlug(slug))} product review">
<script type="application/ld+json">${JSON.stringify(schemaMarkup)}</script>
<style>
  /* (your styles here — kept compact to save space) */
  body{font-family:system-ui,Segoe UI,Arial;background:#f5f5f5;color:#333;padding:20px}
  .container{max-width:800px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.08)}
  .header h1{font-size:2rem;margin-bottom:.5rem}
  .meta-info{background:linear-gradient(135deg,#f8fafc,#e2e8f0);padding:1rem;border-radius:8px;margin:1rem 0}
  .content img.content-image{max-width:100%;height:auto;border-radius:8px}
  .related-item{display:flex;gap:12px;align-items:flex-start;text-decoration:none;color:inherit;padding:12px;border-radius:8px;border:1px solid #e6eef9}
  .related-thumbnail img{width:100px;height:100px;object-fit:cover;border-radius:8px}
</style>
</head>
<body>
  <div class="container">
    <header class="header"><h1>${escapeHtml(frontmatter.title || formatSlug(slug))}</h1>
      ${frontmatter.rating ? `<div class="rating" aria-label="Rating: ${frontmatter.rating}">${'⭐'.repeat(parseInt(frontmatter.rating))} ${frontmatter.rating}/5</div>` : ''}
      ${frontmatter.description ? `<p style="color:#555">${escapeHtml(frontmatter.description)}</p>` : ''}
    </header>

    <div class="meta-info">
      <strong>Published:</strong> ${escapeHtml(frontmatter.date || 'Recently')} |
      <strong>Categories:</strong> ${escapeHtml(Array.isArray(frontmatter.categories) ? frontmatter.categories.join(', ') : (frontmatter.categories || 'Review'))} |
      <strong>Review by:</strong> ReviewIndex Team
    </div>

    ${youtubeEmbed}

    <main class="content">${htmlContent}</main>

    ${relatedPostsHTML}

    ${frontmatter.affiliateLink ? `<aside style="background:linear-gradient(135deg,#fff7ed,#fed7aa);padding:1rem;border-radius:8px;margin-top:1.5rem"><a href="${escapeHtml(frontmatter.affiliateLink)}" target="_blank" rel="nofollow sponsored" style="background:#2563eb;color:#fff;padding:.75rem 1rem;border-radius:8px;text-decoration:none">Check Current Price</a></aside>` : ''}

    <nav style="text-align:center;margin-top:1.5rem"><a href="/" style="display:inline-block;padding:.5rem 1rem;border:2px solid #2563eb;border-radius:6px;text-decoration:none;color:#2563eb">← Back to All Reviews</a></nav>
  </div>
</body>
</html>`;
}

function generateRelatedPostsHTML(relatedPosts, currentCategories) {
  if (!relatedPosts || relatedPosts.length === 0) return '';
  const displayCategory = (normalizeCategories(currentCategories || [])[0] || 'related');
  return `<section class="related-posts" aria-labelledby="related-posts-title" style="margin-top:2rem">
    <h2 id="related-posts-title">🔗 More ${escapeHtml(displayCategory.charAt(0).toUpperCase() + displayCategory.slice(1))} Reviews</h2>
    <div style="display:grid;gap:12px;margin-top:12px">
      ${relatedPosts.map(p => `
        <a class="related-item" href="/review/${encodeURIComponent(p.slug)}" aria-label="${escapeHtml(p.title)}">
          <div class="related-thumbnail"><img src="${escapeHtml(p.image || '/default-thumbnail.jpg')}" alt="${escapeHtml(p.title)}"></div>
          <div>
            <h3 style="margin:0">${escapeHtml(p.title)}</h3>
            ${p.description ? `<p style="margin:.25rem 0;color:#666">${escapeHtml(p.description)}</p>` : ''}
            ${(p.categories || []).map(c => `<span style="display:inline-block;background:#eef6ff;color:#034a86;padding:.15rem .4rem;border-radius:4px;margin-right:.25rem;font-size:.8rem">${escapeHtml(c)}</span>`).join('')}
          </div>
        </a>`).join('')}
    </div>
  </section>`;
}


// -------------------- Small util helpers --------------------

function normalizeCategories(categories) {
  if (!categories) return [];
  if (Array.isArray(categories)) return categories.map(c => String(c).toLowerCase());
  return [String(categories).toLowerCase()];
}

/* end of file */
