// functions/comparison/[...slug].js
export async function onRequest(context) {
    const { request, params, env } = context;
    const slug = params.slug;
    
    try {
        // If it's a direct file request for .md, redirect to proper URL
        if (slug.endsWith('.md')) {
            const cleanSlug = slug.replace('.md', '');
            return Response.redirect(`${new URL(request.url).origin}/comparison/${cleanSlug}`, 301);
        }

        // Fetch the comparison content from GitHub
        const comparisonContent = await fetchComparisonContent(slug, env.GITHUB_TOKEN);
        
        if (!comparisonContent) {
            return renderErrorPage('Comparison not found', 'The requested comparison could not be found.');
        }

        // Convert markdown to HTML and render the comparison page
        const htmlContent = await renderComparisonPage(comparisonContent, slug, request.url);
        
        // Create response with 6-month cache headers
        return new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=15552000, immutable', // 6 months
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'X-Robots-Tag': 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1'
            }
        });

    } catch (error) {
        console.error('Error rendering comparison page:', error);
        return renderErrorPage('Server Error', 'An error occurred while loading the comparison.');
    }
}

async function fetchComparisonContent(slug, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const filePath = `content/comparisons/${slug}.md`;

    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3.raw'
                }
            }
        );

        if (response.status === 200) {
            return await response.text();
        }
        return null;
    } catch (error) {
        console.error('Error fetching comparison:', error);
        return null;
    }
}

async function renderComparisonPage(markdownContent, slug, requestUrl) {
    // Parse frontmatter and content
    const { frontmatter, content } = parseComparisonMarkdown(markdownContent);
    
    // Convert markdown to HTML with comparison-specific formatting
    const htmlContent = convertComparisonMarkdownToHTML(content);
    
    // Generate canonical URL
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    
    // Generate schema markup for comparison
    const schemaMarkup = generateComparisonSchema(frontmatter, slug, canonicalUrl);
    
    // Get products from frontmatter
    const products = frontmatter.comparison_products || [];
    const primaryProduct = products[0] || '';
    
    // Generate social image with fallback
    const socialImage = frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-image.jpg';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(frontmatter.title || formatComparisonSlug(slug))} - ReviewIndex</title>
    <meta name="description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`)}">
    <link rel="canonical" href="${canonicalUrl}">
    
    <!-- SEO Meta Tags -->
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}">
    <meta property="og:description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${escapeHtml(socialImage)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}">
    <meta name="twitter:description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`)}">
    <meta name="twitter:image" content="${escapeHtml(socialImage)}">
    <meta name="twitter:image:alt" content="${escapeHtml(frontmatter.title || formatComparisonSlug(slug))} comparison">
    
    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    ${schemaMarkup}
    </script>
    
    <style>
        :root {
            --primary: #3b82f6;
            --primary-dark: #2563eb;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --light: #f8fafc;
            --dark: #1e293b;
            --border: #e2e8f0;
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
        }
        
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
        }
        
        body { 
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; 
            line-height: 1.6; 
            color: #334155;
            background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            min-height: 100vh;
        }
        
        .container { 
            max-width: 1400px; 
            margin: 0 auto; 
            padding: 20px;
        }
        
        /* Header Styles */
        .header { 
            background: white;
            padding: 3rem 2rem;
            text-align: center;
            border-radius: 20px;
            box-shadow: var(--shadow);
            margin-bottom: 2rem;
            border: 1px solid var(--border);
        }
        
        .header h1 {
            font-size: clamp(2rem, 4vw, 3.5rem);
            margin-bottom: 1rem;
            color: var(--dark);
            line-height: 1.2;
            font-weight: 700;
        }
        
        .header .description {
            font-size: 1.25rem;
            color: #64748b;
            max-width: 800px;
            margin: 0 auto;
        }
        
        /* Quick Summary Cards */
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-bottom: 3rem;
        }
        
        .summary-card {
            background: white;
            padding: 2rem;
            border-radius: 16px;
            box-shadow: var(--shadow);
            text-align: center;
            border: 1px solid var(--border);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        
        .summary-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
        
        .summary-card.winner {
            border-left: 6px solid var(--success);
        }
        
        .summary-card h3 {
            font-size: 1.25rem;
            margin-bottom: 1rem;
            color: var(--dark);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        
        /* Comparison Table */
        .comparison-section {
            background: white;
            border-radius: 20px;
            padding: 3rem 2rem;
            margin-bottom: 3rem;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
        }
        
        .section-title {
            font-size: 2rem;
            margin-bottom: 2rem;
            color: var(--dark);
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.75rem;
        }
        
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            margin: 2rem 0;
            font-size: 1rem;
        }
        
        .comparison-table th {
            background: var(--light);
            padding: 1.25rem 1rem;
            text-align: center;
            font-weight: 600;
            color: var(--dark);
            border: 1px solid var(--border);
        }
        
        .comparison-table td {
            padding: 1rem;
            text-align: center;
            border: 1px solid var(--border);
            vertical-align: top;
        }
        
        .comparison-table tr:nth-child(even) {
            background: #fafafa;
        }
        
        .comparison-table .feature-cell {
            background: var(--light);
            font-weight: 600;
            text-align: left;
            color: var(--dark);
        }
        
        .winner-badge {
            background: var(--success);
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            font-weight: 600;
            display: inline-block;
            margin-top: 0.5rem;
        }
        
        .btn {
            display: inline-block;
            background: var(--primary);
            color: white;
            padding: 0.75rem 1.5rem;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: all 0.3s ease;
            border: none;
            cursor: pointer;
        }
        
        .btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }
        
        .btn-success {
            background: var(--success);
        }
        
        .btn-success:hover {
            background: #0d9c6d;
        }
        
        /* Product Sections */
        .products-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin: 3rem 0;
        }
        
        .product-card {
            background: white;
            border-radius: 16px;
            padding: 2rem;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            transition: transform 0.2s ease;
        }
        
        .product-card:hover {
            transform: translateY(-4px);
        }
        
        .product-header {
            text-align: center;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid var(--border);
        }
        
        .product-header h3 {
            font-size: 1.5rem;
            color: var(--dark);
            margin-bottom: 0.5rem;
        }
        
        .product-image {
            width: 100%;
            max-width: 200px;
            height: auto;
            margin: 1rem auto;
            border-radius: 12px;
        }
        
        .pros-cons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin: 1.5rem 0;
        }
        
        .pros-list, .cons-list {
            padding: 1rem;
            border-radius: 8px;
        }
        
        .pros-list {
            background: #f0fdf4;
            border-left: 4px solid var(--success);
        }
        
        .cons-list {
            background: #fef2f2;
            border-left: 4px solid var(--danger);
        }
        
        .pros-list h4, .cons-list h4 {
            margin-bottom: 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        /* YouTube Embed */
        .youtube-embed {
            margin: 3rem 0;
            text-align: center;
        }
        
        .video-wrapper {
            position: relative;
            width: 100%;
            height: 0;
            padding-bottom: 56.25%;
            margin: 1.5rem 0;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        }
        
        .video-wrapper iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: none;
        }
        
        /* Verdict Section */
        .verdict-section {
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            color: white;
            padding: 4rem 2rem;
            border-radius: 20px;
            margin: 3rem 0;
            text-align: center;
        }
        
        .verdict-section h2 {
            font-size: 2.5rem;
            margin-bottom: 2rem;
            color: white;
        }
        
        .recommendations {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 2rem;
            margin: 2rem 0;
        }
        
        .recommendation {
            background: rgba(255, 255, 255, 0.1);
            padding: 2rem;
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }
        
        /* Footer */
        .footer {
            text-align: center;
            padding: 3rem 2rem;
            color: #64748b;
            font-size: 0.9rem;
        }
        
        .back-link {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--primary);
            text-decoration: none;
            font-weight: 600;
            margin-top: 2rem;
            padding: 1rem 2rem;
            border: 2px solid var(--primary);
            border-radius: 8px;
            transition: all 0.3s ease;
        }
        
        .back-link:hover {
            background: var(--primary);
            color: white;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            .header {
                padding: 2rem 1rem;
            }
            
            .comparison-section {
                padding: 2rem 1rem;
            }
            
            .comparison-table {
                font-size: 0.875rem;
            }
            
            .comparison-table th,
            .comparison-table td {
                padding: 0.75rem 0.5rem;
            }
            
            .products-grid {
                grid-template-columns: 1fr;
            }
            
            .pros-cons {
                grid-template-columns: 1fr;
            }
            
            .summary-cards {
                grid-template-columns: 1fr;
            }
        }
        
        @media (max-width: 480px) {
            .comparison-table {
                display: block;
                overflow-x: auto;
                white-space: nowrap;
            }
        }
        
        /* Print Styles */
        @media print {
            .btn, .back-link {
                display: none;
            }
            
            body {
                background: white;
            }
            
            .container {
                max-width: none;
                padding: 0;
            }
        }
        
        /* Accessibility */
        @media (prefers-reduced-motion: reduce) {
            * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
            }
        }
        
        /* Focus styles */
        button:focus-visible,
        a:focus-visible {
            outline: 2px solid var(--primary);
            outline-offset: 2px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header" role="banner">
            <h1>${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}</h1>
            ${frontmatter.description ? `<p class="description">${escapeHtml(frontmatter.description)}</p>` : ''}
        </header>
        
        <!-- Quick Summary Cards -->
        <div class="summary-cards">
            <div class="summary-card winner">
                <h3>🏆 Overall Winner</h3>
                <p style="font-size: 1.5rem; font-weight: 600; color: var(--success);">${products[0] || 'Check comparison'}</p>
                <p style="color: #64748b; margin-top: 0.5rem;">Best all-around choice for most users</p>
            </div>
            
            <div class="summary-card">
                <h3>💰 Best Value</h3>
                <p style="font-size: 1.5rem; font-weight: 600; color: var(--warning);">${products[1] || products[0] || 'Check comparison'}</p>
                <p style="color: #64748b; margin-top: 0.5rem;">Great performance at competitive price</p>
            </div>
            
            <div class="summary-card">
                <h3>⚡ Performance</h3>
                <p style="font-size: 1.5rem; font-weight: 600; color: var(--primary);">${products[0] || 'Check comparison'}</p>
                <p style="color: #64748b; margin-top: 0.5rem;">Top-tier performance for power users</p>
            </div>
        </div>
        
        <main role="main">
            <!-- Comparison Table -->
            <section class="comparison-section" aria-labelledby="specs-title">
                <h2 class="section-title" id="specs-title">⚡ Quick Comparison</h2>
                <div class="comparison-table-container">
                    ${htmlContent}
                </div>
            </section>
            
            <!-- Individual Product Analysis -->
            <section class="comparison-section" aria-labelledby="products-title">
                <h2 class="section-title" id="products-title">🔍 Detailed Analysis</h2>
                <div class="products-grid">
                    ${generateProductCards(products)}
                </div>
            </section>
            
            <!-- Final Verdict -->
            <section class="verdict-section" aria-labelledby="verdict-title">
                <h2 id="verdict-title">🏆 Final Verdict</h2>
                <div class="recommendations">
                    ${generateRecommendations(products)}
                </div>
                <a href="/comparisons" class="back-link">
                    ← View All Comparisons
                </a>
            </section>
        </main>
        
        <footer class="footer" role="contentinfo">
            <p>© ${new Date().getFullYear()} ReviewIndex. All comparisons are independently researched.</p>
            <p>Last updated: ${frontmatter.date || 'Recently'}</p>
        </footer>
    </div>
    
    <script>
        // Performance optimization
        document.addEventListener('DOMContentLoaded', function() {
            // Lazy load images
            const images = document.querySelectorAll('img[data-src]');
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                        imageObserver.unobserve(img);
                    }
                });
            });
            
            images.forEach(img => imageObserver.observe(img));
            
            // Smooth scrolling for anchor links
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function (e) {
                    e.preventDefault();
                    const target = document.querySelector(this.getAttribute('href'));
                    if (target) {
                        target.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start'
                        });
                    }
                });
            });
            
            // Add loading states
            document.querySelectorAll('a[target="_blank"]').forEach(link => {
                link.addEventListener('click', function() {
                    this.style.opacity = '0.7';
                });
            });
        });
        
        // Service Worker registration for caching
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
                navigator.serviceWorker.register('/sw.js');
            });
        }
    </script>
</body>
</html>`;
}

function parseComparisonMarkdown(content) {
    const frontmatter = {};
    let markdownContent = content;
    
    // Parse YAML frontmatter
    if (content.startsWith('---')) {
        const end = content.indexOf('---', 3);
        if (end !== -1) {
            const yaml = content.substring(3, end).trim();
            markdownContent = content.substring(end + 3).trim();
            
            yaml.split('\n').forEach(line => {
                const colon = line.indexOf(':');
                if (colon > 0) {
                    const key = line.substring(0, colon).trim();
                    let value = line.substring(colon + 1).trim();
                    
                    // Remove quotes
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith("'") && value.endsWith("'")) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith('[') && value.endsWith(']')) {
                        // Handle array values
                        value = value.substring(1, value.length - 1).split(',').map(item => item.trim().replace(/"/g, ''));
                    }
                    
                    frontmatter[key] = value;
                }
            });
        }
    }
    
    return { frontmatter, content: markdownContent };
}

function convertComparisonMarkdownToHTML(markdown) {
    // Enhanced markdown to HTML conversion for comparison tables
    let html = markdown;
    
    // Convert markdown tables to HTML tables
    html = html.replace(/\|([^\n]+)\|\n\|([^\n]+)\|\n((?:\|[^\n]+\|\n?)+)/g, function(match, headers, separators, rows) {
        const headerCells = headers.split('|').map(cell => cell.trim()).filter(cell => cell);
        const rowLines = rows.trim().split('\n');
        
        let tableHTML = '<table class="comparison-table" role="table" aria-label="Product comparison table">\n<thead>\n<tr>';
        
        // Add headers
        headerCells.forEach(header => {
            tableHTML += `<th scope="col">${header}</th>`;
        });
        tableHTML += '</tr>\n</thead>\n<tbody>';
        
        // Add rows
        rowLines.forEach(line => {
            const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
            if (cells.length > 0) {
                tableHTML += '<tr>';
                cells.forEach((cell, index) => {
                    const isFeature = index === 0;
                    const cellClass = isFeature ? 'feature-cell' : '';
                    const cellContent = cell.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                           .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                           .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy" style="max-width: 100px; height: auto;">')
                                           .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
                    
                    tableHTML += `<td class="${cellClass}">${cellContent}</td>`;
                });
                tableHTML += '</tr>';
            }
        });
        
        tableHTML += '</tbody>\n</table>';
        return tableHTML;
    });
    
    // Convert other markdown elements
    html = html
        .replace(/^# (.*)$/gm, '<h2>$1</h2>')
        .replace(/^## (.*)$/gm, '<h3>$1</h3>')
        .replace(/^### (.*)$/gm, '<h4>$1</h4>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy">')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>');
    
    return html;
}

function generateProductCards(products) {
    if (!products || products.length === 0) return '';
    
    return products.map(product => `
        <div class="product-card">
            <div class="product-header">
                <h3>${escapeHtml(product)}</h3>
                <div class="rating">${'⭐'.repeat(4)} 4.5/5</div>
            </div>
            
            <div class="pros-cons">
                <div class="pros-list">
                    <h4>✅ Pros</h4>
                    <ul>
                        <li>Excellent performance</li>
                        <li>Great value for money</li>
                        <li>Reliable brand</li>
                    </ul>
                </div>
                
                <div class="cons-list">
                    <h4>❌ Cons</h4>
                    <ul>
                        <li>Could be improved</li>
                        <li>Some limitations</li>
                    </ul>
                </div>
            </div>
            
            <div style="text-align: center; margin-top: 1.5rem;">
                <a href="#" class="btn btn-success">Check Price</a>
            </div>
        </div>
    `).join('');
}

function generateRecommendations(products) {
    if (!products || products.length === 0) return '';
    
    return products.map((product, index) => {
        const reasons = [
            'Best for overall performance and features',
            'Great value with balanced performance',
            'Excellent for specific use cases'
        ];
        
        return `
            <div class="recommendation">
                <h3 style="color: white; margin-bottom: 1rem;">${escapeHtml(product)}</h3>
                <p style="color: #cbd5e1;">${reasons[index] || reasons[0]}</p>
            </div>
        `;
    }).join('');
}

function generateComparisonSchema(frontmatter, slug, url) {
    const products = frontmatter.comparison_products || [];
    
    return JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": frontmatter.title || formatComparisonSlug(slug),
        "description": frontmatter.description || `Comparison of ${products.join(' vs ')}`,
        "image": frontmatter.featured_image || '',
        "datePublished": frontmatter.date || new Date().toISOString(),
        "dateModified": frontmatter.date || new Date().toISOString(),
        "author": {
            "@type": "Organization",
            "name": "ReviewIndex"
        },
        "publisher": {
            "@type": "Organization",
            "name": "ReviewIndex",
            "logo": {
                "@type": "ImageObject",
                "url": "https://reviewindex.pages.dev/logo.png"
            }
        },
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": url
        }
    }, null, 2);
}

function formatComparisonSlug(slug) {
    return slug.split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .replace(/ Vs /g, ' vs ');
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderErrorPage(title, message) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <title>${title} - ReviewIndex</title>
    <meta name="robots" content="noindex">
    <style>
        body { 
            font-family: system-ui, sans-serif; 
            text-align: center; 
            padding: 2rem; 
            background: #f5f5f5;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
        }
        .error-container { 
            background: white; 
            padding: 3rem; 
            border-radius: 12px; 
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
            max-width: 500px;
            width: 100%;
        }
        h1 { 
            color: #dc2626; 
            margin-bottom: 1rem;
            font-size: 2rem;
        }
        p {
            color: #666;
            margin-bottom: 2rem;
            line-height: 1.6;
        }
        a { 
            color: #2563eb; 
            text-decoration: none;
            font-weight: 600;
            padding: 0.75rem 1.5rem;
            border: 2px solid #2563eb;
            border-radius: 6px;
            transition: all 0.3s ease;
        }
        a:hover {
            background: #2563eb;
            color: white;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>⚠️ ${title}</h1>
        <p>${message}</p>
        <a href="/">← Return to Homepage</a>
    </div>
</body>
</html>`;
    
    return new Response(html, { 
        status: 404,
        headers: { 
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
    });
}
