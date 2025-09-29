// functions/comparison/[...slug].js
import { HTMLRewriter } from './html-rewriter';

const CACHE_TTL = 15552000; // 6 months
const GITHUB_CONFIG = {
  owner: 'yourfreetools',
  repo: 'reviewindex',
  branch: 'main'
};

export async function onRequest({ request, params, env }) {
  const { slug } = params;
  
  try {
    // Handle .md redirects
    if (slug.endsWith('.md')) {
      const cleanSlug = slug.replace('.md', '');
      return Response.redirect(`${new URL(request.url).origin}/comparison/${cleanSlug}`, 301);
    }

    // Check cache first
    const cacheKey = `comparison:${slug}`;
    const cached = await env.KV.get(cacheKey, 'json');
    if (cached) {
      return new Response(cached.html, {
        headers: getResponseHeaders(cached.metadata)
      });
    }

    // Fetch and process content
    const content = await fetchMarkdownContent(slug, env.GITHUB_TOKEN);
    if (!content) return render404();

    const { frontmatter, markdown } = parseFrontmatter(content);
    const products = frontmatter.comparison_products || [];
    const winners = extractWinners(markdown);
    
    const related = await fetchRelatedComparisons(slug, frontmatter.categories, env.GITHUB_TOKEN);
    const html = await renderComparisonPage({ frontmatter, markdown, slug, products, winners, related });

    // Cache the response
    const metadata = { 
      contentType: 'text/html; charset=utf-8',
      cacheControl: `public, max-age=${CACHE_TTL}`,
      lastModified: new Date().toUTCString()
    };
    
    await env.KV.put(cacheKey, JSON.stringify({ html, metadata }), { expirationTtl: CACHE_TTL });

    return new Response(html, { headers: getResponseHeaders(metadata) });

  } catch (error) {
    console.error('Comparison render error:', error);
    return render500();
  }
}

async function fetchMarkdownContent(slug, token) {
  const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/content/comparisons/${slug}.md`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3.raw',
      'User-Agent': 'ReviewIndex/1.0'
    },
    cf: { cacheTtl: 300 } // Cache API responses for 5 minutes
  });

  return response.ok ? response.text() : null;
}

async function fetchRelatedComparisons(currentSlug, categories, token) {
  if (!categories?.length) return [];

  try {
    const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/content/comparisons`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'ReviewIndex/1.0'
      }
    });

    if (!response.ok) return [];

    const files = await response.json();
    const comparisons = [];
    const excludedCategories = new Set(['review', 'reviews', 'comparison', 'comparisons']);

    for (const file of files) {
      if (!file.name.endsWith('.md') || file.name === `${currentSlug}.md`) continue;
      if (comparisons.length >= 3) break;

      try {
        const fileResponse = await fetch(file.download_url);
        if (!fileResponse.ok) continue;

        const content = await fileResponse.text();
        const { frontmatter } = parseFrontmatter(content);
        const fileCategories = Array.isArray(frontmatter.categories) ? frontmatter.categories : [];

        const hasMatch = fileCategories.some(cat => 
          categories.includes(cat) && !excludedCategories.has(cat.toLowerCase())
        );

        if (hasMatch) {
          comparisons.push({
            slug: file.name.replace('.md', ''),
            title: frontmatter.title,
            description: frontmatter.description,
            products: frontmatter.comparison_products || [],
            image: frontmatter.featured_image
          });
        }
      } catch {
        // Skip invalid files
        continue;
      }
    }

    return comparisons;
  } catch {
    return [];
  }
}

function parseFrontmatter(content) {
  const frontmatter = {};
  let markdown = content;

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (frontmatterMatch) {
    const [, yaml, mdContent] = frontmatterMatch;
    markdown = mdContent.trim();

    yaml.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split(':');
      if (!key || !valueParts.length) return;

      let value = valueParts.join(':').trim();
      
      // Handle array values
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      } 
      // Handle string values
      else if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }

      frontmatter[key.trim()] = value;
    });
  }

  return { frontmatter, markdown };
}

function extractWinners(content) {
  const patterns = {
    overall: /🏆 Overall Winner: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/,
    budget: /💰 Best Value: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/,
    performance: /⚡ Performance King: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/
  };

  const winners = {};
  
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = content.match(pattern);
    if (match) {
      winners[key] = {
        product: match[1].trim(),
        description: match[2]?.trim() || getDefaultDescription(key)
      };
    }
  }

  return winners;
}

function getDefaultDescription(type) {
  const descriptions = {
    overall: 'Best all-around choice for most users',
    budget: 'Great performance at competitive price',
    performance: 'Top-tier performance for power users'
  };
  return descriptions[type] || '';
}

async function renderComparisonPage({ frontmatter, markdown, slug, products, winners, related }) {
  const title = frontmatter.title || generateTitle(products);
  const description = frontmatter.description || generateDescription(products);
  const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;

  const schema = generateStructuredData({ frontmatter, slug, products, winners });
  const htmlContent = await processMarkdown(markdown);

  return `
<!DOCTYPE html>
<html lang="en" itemscope itemtype="https://schema.org/Product">
<head>
  ${renderMetaTags({ title, description, frontmatter, canonicalUrl, products })}
  ${renderStructuredData(schema)}
  ${renderStyles()}
</head>
<body>
  ${renderSkipLink()}
  <div class="container">
    ${renderBreadcrumb(products, slug)}
    ${renderHeader({ title, description })}
    <main id="main-content">
      ${renderWinnerCards({ winners, products })}
      ${htmlContent}
      ${renderRelatedComparisons(related)}
    </main>
    ${renderFooter(frontmatter.date)}
  </div>
  ${renderScripts()}
</body>
</html>`;
}

function renderMetaTags({ title, description, frontmatter, canonicalUrl, products }) {
  const image = frontmatter.featured_image || '/og-default.jpg';
  
  return `
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${canonicalUrl}">
    
    <meta name="robots" content="index, follow, max-image-preview:large">
    <meta name="keywords" content="${products.join(', ')}, comparison, review, buy">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="product">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${image}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${image}">
    
    <!-- Additional Meta -->
    <meta name="theme-color" content="#2563eb">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" href="/icon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">`;
}

function renderStructuredData(schema) {
  return `<script type="application/ld+json">${JSON.stringify(schema, null, 2)}</script>`;
}

function renderStyles() {
  return `
  <style>
    :root {
      --primary: #2563eb;
      --primary-dark: #1d4ed8;
      --primary-light: #dbeafe;
      --success: #059669;
      --success-light: #d1fae5;
      --gray-50: #f9fafb;
      --gray-100: #f3f4f6;
      --gray-200: #e5e7eb;
      --gray-600: #4b5563;
      --gray-900: #111827;
      --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    }
    
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }
    
    html {
      scroll-behavior: smooth;
    }
    
    body { 
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      color: var(--gray-900);
      background: var(--gray-50);
      min-height: 100vh;
    }
    
    .container { 
      max-width: 1200px; 
      margin: 0 auto; 
      background: white;
      min-height: 100vh;
      box-shadow: 0 0 0 1px var(--gray-200);
    }
    
    .skip-link {
      position: absolute;
      top: -40px;
      left: 6px;
      background: var(--primary);
      color: white;
      padding: 8px 12px;
      text-decoration: none;
      border-radius: 4px;
      z-index: 1000;
      transition: top 0.2s;
    }
    
    .skip-link:focus {
      top: 6px;
    }
    
    .breadcrumb {
      padding: 1rem 2rem;
      background: var(--gray-50);
      border-bottom: 1px solid var(--gray-200);
      font-size: 0.875rem;
    }
    
    .breadcrumb ol {
      list-style: none;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .breadcrumb a {
      color: var(--primary);
      text-decoration: none;
    }
    
    .breadcrumb [aria-current] {
      color: var(--gray-600);
    }
    
    .header {
      padding: 3rem 2rem;
      text-align: center;
      background: linear-gradient(135deg, var(--primary), var(--primary-dark));
      color: white;
    }
    
    .header h1 {
      font-size: clamp(2rem, 5vw, 3rem);
      margin-bottom: 1rem;
      font-weight: 800;
      line-height: 1.2;
    }
    
    .header p {
      font-size: 1.25rem;
      opacity: 0.9;
      max-width: 600px;
      margin: 0 auto;
    }
    
    main {
      padding: 2rem;
    }
    
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.5rem;
      margin: 2rem 0;
    }
    
    .summary-card {
      background: white;
      padding: 1.5rem;
      border-radius: 8px;
      border-left: 4px solid var(--primary);
      box-shadow: var(--shadow);
    }
    
    .summary-card.winner {
      border-left-color: var(--success);
      background: var(--success-light);
    }
    
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 2rem;
      margin: 2rem 0;
    }
    
    .product-card {
      border: 1px solid var(--gray-200);
      border-radius: 8px;
      overflow: hidden;
      background: white;
    }
    
    .product-header {
      padding: 1.5rem;
      text-align: center;
      background: var(--gray-50);
      border-bottom: 1px solid var(--gray-200);
    }
    
    .product-image {
      max-width: 200px;
      height: auto;
      margin: 0 auto 1rem;
    }
    
    .affiliate-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--primary);
      color: white;
      padding: 0.75rem 1.5rem;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      transition: all 0.2s;
    }
    
    .affiliate-btn:hover {
      background: var(--primary-dark);
      transform: translateY(-1px);
    }
    
    .comparison-table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5rem 0;
      background: white;
      box-shadow: var(--shadow);
    }
    
    .comparison-table th {
      background: var(--primary);
      color: white;
      padding: 1rem;
      text-align: left;
      font-weight: 600;
    }
    
    .comparison-table td {
      padding: 1rem;
      border-bottom: 1px solid var(--gray-200);
    }
    
    .related-section {
      margin: 3rem 0;
      padding: 2rem;
      background: var(--gray-50);
      border-radius: 8px;
    }
    
    .related-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
      margin-top: 1.5rem;
    }
    
    .related-card {
      background: white;
      padding: 1.5rem;
      border-radius: 8px;
      text-decoration: none;
      color: inherit;
      border: 1px solid var(--gray-200);
      transition: all 0.2s;
    }
    
    .related-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-lg);
    }
    
    .footer {
      text-align: center;
      padding: 2rem;
      color: var(--gray-600);
      border-top: 1px solid var(--gray-200);
      background: var(--gray-50);
    }
    
    @media (max-width: 768px) {
      main, .header {
        padding: 1.5rem 1rem;
      }
      
      .product-grid,
      .summary-cards,
      .related-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>`;
}

function renderSkipLink() {
  return `<a href="#main-content" class="skip-link">Skip to main content</a>`;
}

function renderBreadcrumb(products, slug) {
  return `
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <ol>
      <li><a href="/">Home</a></li>
      <li><a href="/comparisons">Comparisons</a></li>
      <li aria-current="page">${escapeHtml(products.join(' vs '))}</li>
    </ol>
  </nav>`;
}

function renderHeader({ title, description }) {
  return `
  <header class="header">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
  </header>`;
}

function renderWinnerCards({ winners, products }) {
  if (Object.keys(winners).length === 0) return '';

  const cards = [
    { key: 'overall', icon: '🏆', label: 'Overall Winner' },
    { key: 'budget', icon: '💰', label: 'Best Value' },
    { key: 'performance', icon: '⚡', label: 'Performance King' }
  ];

  return `
  <section class="summary-cards">
    ${cards.map(({ key, icon, label }) => {
      const winner = winners[key];
      if (!winner) return '';
      
      return `
      <div class="summary-card winner">
        <h3>${icon} ${label}</h3>
        <p style="font-size: 1.25rem; font-weight: 700; margin: 0.5rem 0;">${escapeHtml(winner.product)}</p>
        <p style="color: var(--gray-600);">${escapeHtml(winner.description)}</p>
      </div>`;
    }).join('')}
  </section>`;
}

function renderRelatedComparisons(related) {
  if (!related.length) return '';

  return `
  <section class="related-section">
    <h2>Related Comparisons</h2>
    <div class="related-grid">
      ${related.map(comp => `
        <a href="/comparison/${comp.slug}" class="related-card">
          <h3>${escapeHtml(comp.title)}</h3>
          <p>${escapeHtml(comp.description || '')}</p>
          <div style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--gray-600);">
            ${comp.products.join(' vs ')}
          </div>
        </a>
      `).join('')}
    </div>
  </section>`;
}

function renderFooter(date) {
  const lastUpdated = date ? new Date(date).toLocaleDateString() : 'Recently';
  
  return `
  <footer class="footer">
    <p>&copy; ${new Date().getFullYear()} ReviewIndex. All comparisons are independently researched.</p>
    <p><small>Last updated: ${lastUpdated}</small></p>
  </footer>`;
}

function renderScripts() {
  return `
  <script>
    // Performance optimizations
    document.addEventListener('DOMContentLoaded', () => {
      // Lazy load images
      const images = document.querySelectorAll('img[loading="lazy"]');
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.src = img.dataset.src;
            observer.unobserve(img);
          }
        });
      });
      
      images.forEach(img => observer.observe(img));
      
      // Affiliate link tracking
      document.querySelectorAll('a[rel*="sponsored"]').forEach(link => {
        link.addEventListener('click', (e) => {
          // Analytics tracking would go here
          console.log('Affiliate click:', e.target.href);
        });
      });
    });
  </script>`;
}

async function processMarkdown(markdown) {
  // Use HTMLRewriter for efficient markdown processing
  let html = markdown;
  
  // Convert basic markdown syntax
  html = html
    .replace(/### (.*?)\n/g, '<h3>$1</h3>')
    .replace(/## (.*?)\n/g, '<h2>$1</h2>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/!\[(.*?)\]\((.*?)\)/g, '<img data-src="$2" alt="$1" loading="lazy" class="product-image">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)\{: \.btn \.btn-(?:primary|sm)\}/g, 
      '<a href="$2" class="affiliate-btn" target="_blank" rel="nofollow sponsored">$1</a>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Preserve iframes (videos)
  html = html.replace(/<iframe[^>]*><\/iframe>/g, 
    '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">$&</div>');

  return html;
}

function generateStructuredData({ frontmatter, slug, products, winners }) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": frontmatter.title,
    "description": frontmatter.description,
    "image": frontmatter.featured_image ? [frontmatter.featured_image] : [],
    "brand": products.map(name => ({ "@type": "Brand", "name" })),
    "offers": {
      "@type": "AggregateOffer",
      "offerCount": products.length,
      "lowPrice": "12",
      "highPrice": "22",
      "priceCurrency": "USD"
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `https://reviewindex.pages.dev/comparison/${slug}`
    }
  };
}

function generateTitle(products) {
  return `${products.join(' vs ')} Comparison - ReviewIndex`;
}

function generateDescription(products) {
  return `Comprehensive comparison of ${products.join(' vs ')}. Detailed analysis of features, specifications, prices, and performance to help you make the best choice.`;
}

function getResponseHeaders(metadata) {
  const headers = new Headers({
    'Content-Type': metadata.contentType,
    'Cache-Control': metadata.cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });

  if (metadata.lastModified) {
    headers.set('Last-Modified', metadata.lastModified);
  }

  return headers;
}

function escapeHtml(unsafe) {
  return unsafe?.replace(/[&<>"']/g, 
    match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match])
  ) || '';
}

function render404() {
  return new Response(notFoundTemplate(), { 
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function render500() {
  return new Response(errorTemplate(), { 
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function notFoundTemplate() {
  return `<!DOCTYPE html>
<html><body style="font-family: sans-serif; text-align: center; padding: 2rem;">
  <h1>404 - Comparison Not Found</h1>
  <p>The requested product comparison could not be found.</p>
  <a href="/">Return Home</a>
</body></html>`;
}

function errorTemplate() {
  return `<!DOCTYPE html>
<html><body style="font-family: sans-serif; text-align: center; padding: 2rem;">
  <h1>500 - Server Error</h1>
  <p>An error occurred while loading the comparison.</p>
  <a href="/">Return Home</a>
</body></html>`;
}
