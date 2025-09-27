// functions/review/[...slug].js
// Updated version - properly parses and displays all related posts with descriptions

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

    // 3) Use ALL related posts from frontmatter with proper parsing
    let relatedPosts = [];
    
    if (frontmatter.related && Array.isArray(frontmatter.related)) {
      relatedPosts = frontmatter.related.map(r => ({
        slug: r.slug || '',
        title: r.title || formatSlug(r.slug || ''),
        description: r.description || '',
        categories: Array.isArray(r.categories) ? r.categories : (r.categories ? [r.categories] : [])
      }));
      console.log(`✅ Using ${relatedPosts.length} pre-computed related posts for ${slug}`);
    } else {
      console.log(`⚠️ No pre-computed related posts found for ${slug}`);
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
        Accept: 'application/vnd.github.v3.raw'
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

async function safeText(res) {
  try { return await res.text(); } catch { return '[no body]'; }
}

// -------------------- YAML frontmatter parser --------------------

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
    let line = lines[i].trim();
    if (!line) { i++; continue; }
    
    // Handle related posts array with nested objects
    if (line === 'related:') {
      const relatedItems = [];
      i++;
      
      while (i < lines.length && lines[i].startsWith('  - ')) {
        const itemLine = lines[i].substring(4).trim();
        if (itemLine === 'slug:') {
          // Start of a new related post object
          const relatedItem = {};
          i++;
          
          while (i < lines.length && lines[i].startsWith('    ')) {
            const propLine = lines[i].trim();
            const propMatch = propLine.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
            
            if (propMatch) {
              const key = propMatch[1];
              let value = propMatch[2].trim();
              
              // Remove quotes if present
              if ((value.startsWith('"') && value.endsWith('"')) || 
                  (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length - 1);
              }
              
              // Handle categories array
              if (key === 'categories' && value.startsWith('[')) {
                value = parseArrayInline(value);
              }
              
              relatedItem[key] = value;
            }
            i++;
          }
          relatedItems.push(relatedItem);
        } else {
          i++;
        }
      }
      fm.related = relatedItems;
      continue;
    }
    
    // Handle regular key-value pairs
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      const key = m[1];
      let value = m[2].trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      
      // Handle arrays
      if (value.startsWith('[') && value.endsWith(']')) {
        fm[key] = parseArrayInline(value);
      } 
      // Handle booleans
      else if (value === 'true' || value === 'false') {
        fm[key] = value === 'true';
      }
      // Handle nested objects (simple cases)
      else if (value === '' && i + 1 < lines.length && lines[i + 1].trim().startsWith('- ')) {
        const arrayItems = [];
        i++;
        while (i < lines.length && lines[i].trim().startsWith('- ')) {
          arrayItems.push(lines[i].trim().substring(2));
          i++;
        }
        fm[key] = arrayItems;
        continue;
      }
      else {
        fm[key] = value;
      }
    }
    i++;
  }
  return fm;
}

function parseArrayInline(text) {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.trim() === '') return [];
  
  return inner.split(',').map(x => {
    let value = x.trim();
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }
    return value;
  });
}

// -------------------- Rendering / helpers --------------------

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

async function renderPostPage(frontmatter, htmlContent, slug, requestUrl, relatedPosts = []) {
  const canonicalUrl = `https://reviewindex.pages.dev/review/${slug}`;
  const schemaMarkup = generateSchemaMarkup(frontmatter, slug, canonicalUrl);
  const socialImage = frontmatter.image || '';
  const youtubeEmbed = frontmatter.youtubeId ? generateYouTubeEmbed(frontmatter.youtubeId, frontmatter.title || formatSlug(slug)) : '';
  const relatedPostsHTML = generateRelatedPostsHTML(relatedPosts, frontmatter.categories);

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
  * { box-sizing: border-box; }
  body{font-family:system-ui,Segoe UI,Arial;background:#f5f5f5;color:#333;padding:20px;margin:0}
  .container{max-width:800px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.08)}
  .header h1{font-size:2rem;margin-bottom:.5rem}
  .meta-info{background:linear-gradient(135deg,#f8fafc,#e2e8f0);padding:1rem;border-radius:8px;margin:1rem 0}
  .content img.content-image{max-width:100%;height:auto;border-radius:8px}
  .related-item{display:block;text-decoration:none;color:inherit;padding:16px;border-radius:8px;border:1px solid #e6eef9;transition:transform 0.2s;margin-bottom:12px}
  .related-item:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,0.1);background:#f8fafc}
  .related-item h3{color:#2563eb;margin:0 0 8px 0;font-size:1.2rem}
  .related-item p{color:#666;margin:8px 0;line-height:1.4}
  .related-categories{margin-top:8px}
  .related-category-tag{display:inline-block;background:#eef6ff;color:#034a86;padding:2px 8px;border-radius:12px;margin-right:6px;font-size:0.8rem}
  
  /* Responsive YouTube Embed */
  .youtube-embed { margin: 2rem 0; }
  .video-wrapper {
    position: relative;
    width: 100%;
    height: 0;
    padding-bottom: 56.25%; /* 16:9 aspect ratio */
    margin: 1rem 0;
  }
  .video-wrapper iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 8px;
    border: none;
  }
  .video-caption {
    text-align: center;
    color: #666;
    font-style: italic;
    margin-top: 0.5rem;
  }
  
  /* Mobile Responsive */
  @media (max-width: 768px) {
    body { padding: 10px; }
    .container { padding: 20px; border-radius: 8px; }
    .header h1 { font-size: 1.6rem; }
    .meta-info { font-size: 0.9rem; padding: 0.8rem; }
    .youtube-embed { margin: 1.5rem 0; }
    .related-item h3 { font-size: 1.1rem; }
  }
  
  @media (max-width: 480px) {
    .container { padding: 16px; }
    .header h1 { font-size: 1.4rem; }
    .meta-info { font-size: 0.85rem; padding: 0.6rem; }
    .related-item { padding: 12px; }
    .related-item h3 { font-size: 1rem; }
  }
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
    <div style="margin-top:16px">
      ${relatedPosts.map(p => `
        <a class="related-item" href="/review/${encodeURIComponent(p.slug)}" aria-label="${escapeHtml(p.title)}">
          <h3>${escapeHtml(p.title)}</h3>
          ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
          ${p.categories && p.categories.length > 0 ? `
            <div class="related-categories">
              ${p.categories.map(c => `<span class="related-category-tag">${escapeHtml(c)}</span>`).join('')}
            </div>
          ` : ''}
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

function renderErrorPage(title, message) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ReviewIndex</title>
  <style>
    body{font-family:system-ui;background:#f5f5f5;color:#333;padding:40px 20px;text-align:center}
    .container{max-width:600px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.08)}
    h1{color:#dc2626;margin-bottom:1rem}
    p{color:#666;margin-bottom:2rem}
    a{color:#2563eb;text-decoration:none}
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">← Back to Home</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/* end of file */
