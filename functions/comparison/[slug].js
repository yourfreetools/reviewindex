// functions/comparison/[...slug].js
export async function onRequest(context) {
    const { request, params, env } = context;
    const slug = params.slug;
    
    try {
        // Handle .md file requests
        if (slug.endsWith('.md')) {
            const cleanSlug = slug.replace('.md', '');
            return Response.redirect(`${new URL(request.url).origin}/comparison/${cleanSlug}`, 301);
        }

        // Fetch markdown content
        const mdContent = await fetchMarkdownContent(slug, env.GITHUB_TOKEN);
        if (!mdContent) {
            return renderNotFoundPage();
        }

        // Parse frontmatter and content
        const { frontmatter, content } = parseMarkdown(mdContent);
        const products = frontmatter.comparison_products || [];
        
        // Extract winners from content
        const winners = extractWinners(content);
        
        // Get related comparisons
        const relatedComparisons = await fetchRelatedComparisons(slug, frontmatter.categories, env.GITHUB_TOKEN);

        // Generate HTML page
        const html = generateHTMLPage(frontmatter, content, slug, products, relatedComparisons, winners);
        
        return new Response(html, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=15552000',
                'X-Content-Type-Options': 'nosniff'
            }
        });

    } catch (error) {
        console.error('Error:', error);
        return renderErrorPage();
    }
}

async function fetchMarkdownContent(slug, token) {
    try {
        const response = await fetch(
            `https://api.github.com/repos/yourfreetools/reviewindex/contents/content/comparisons/${slug}.md`,
            {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3.raw',
                    'User-Agent': 'ReviewIndex-App'
                }
            }
        );
        return response.status === 200 ? await response.text() : null;
    } catch {
        return null;
    }
}

async function fetchRelatedComparisons(currentSlug, categories, token) {
    if (!categories || !Array.isArray(categories)) return [];
    
    try {
        const response = await fetch(
            'https://api.github.com/repos/yourfreetools/reviewindex/contents/content/comparisons',
            {
                headers: {
                    'Authorization': `token ${token}`,
                    'User-Agent': 'ReviewIndex-App'
                }
            }
        );

        if (response.status !== 200) return [];

        const files = await response.json();
        const comparisons = [];
        const excludedCats = ['review', 'reviews', 'comparison', 'comparisons'];

        for (const file of files) {
            if (file.name.endsWith('.md') && file.name !== `${currentSlug}.md`) {
                try {
                    const fileResponse = await fetch(file.download_url);
                    if (fileResponse.status === 200) {
                        const content = await fileResponse.text();
                        const { frontmatter } = parseMarkdown(content);
                        const fileCats = Array.isArray(frontmatter.categories) ? frontmatter.categories : [];
                        
                        const hasMatch = fileCats.some(cat => 
                            categories.includes(cat) && !excludedCats.includes(cat.toLowerCase())
                        );

                        if (hasMatch && comparisons.length < 3) {
                            comparisons.push({
                                slug: file.name.replace('.md', ''),
                                title: frontmatter.title,
                                description: frontmatter.description,
                                products: frontmatter.comparison_products || []
                            });
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
        }
        return comparisons;
    } catch {
        return [];
    }
}

function parseMarkdown(content) {
    const frontmatter = {};
    let markdownContent = content;

    if (content.startsWith('---')) {
        const end = content.indexOf('---', 3);
        if (end !== -1) {
            const yaml = content.substring(3, end).trim();
            markdownContent = content.substring(end + 3).trim();
            
            yaml.split('\n').forEach(line => {
                const colon = line.indexOf(':');
                if (colon > 0) {
                    let key = line.substring(0, colon).trim();
                    let value = line.substring(colon + 1).trim();
                    
                    if (value.startsWith('[') && value.endsWith(']')) {
                        value = value.substring(1, value.length - 1).split(',').map(item => item.trim().replace(/"/g, ''));
                    } else if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith("'") && value.endsWith("'")) {
                        value = value.substring(1, value.length - 1);
                    }
                    
                    frontmatter[key] = value;
                }
            });
        }
    }

    return { frontmatter, content: markdownContent };
}

function extractWinners(content) {
    const winners = {};
    
    // Extract overall winner
    const overallMatch = content.match(/🏆 Overall Winner: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/);
    if (overallMatch) {
        winners.overall = overallMatch[1].trim();
        winners.overallDescription = overallMatch[2] ? overallMatch[2].trim() : 'Best all-around choice for most users';
    }
    
    // Extract budget winner
    const budgetMatch = content.match(/💰 Best Value: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/);
    if (budgetMatch) {
        winners.budget = budgetMatch[1].trim();
        winners.budgetDescription = budgetMatch[2] ? budgetMatch[2].trim() : 'Great performance at competitive price';
    }
    
    // Extract performance winner
    const performanceMatch = content.match(/⚡ Performance King: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/);
    if (performanceMatch) {
        winners.performance = performanceMatch[1].trim();
        winners.performanceDescription = performanceMatch[2] ? performanceMatch[2].trim() : 'Top-tier performance for power users';
    }
    
    return winners;
}

function generateHTMLPage(frontmatter, content, slug, products, relatedComparisons, winners) {
    const title = frontmatter.title || `${products.join(' vs ')} Comparison`;
    const description = frontmatter.description || `Detailed comparison of ${products.join(' vs ')}. Features, specs, prices, and expert analysis.`;
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    
    const htmlContent = convertContentToHTML(content);
    const schema = generateSchemaMarkup(frontmatter, slug, products, winners);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${canonicalUrl}">
    
    <meta name="robots" content="index, follow">
    <meta name="keywords" content="${products.join(', ')}, comparison, review">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${frontmatter.featured_image || 'https://reviewindex.pages.dev/og-image.jpg'}">
    
    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    
    <!-- Schema.org -->
    <script type="application/ld+json">
    ${schema}
    </script>
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            line-height: 1.6; 
            color: #333;
            background: #f8fafc;
            padding: 20px;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 3rem 2rem;
            text-align: center;
        }
        .header h1 { 
            font-size: 2.5rem; 
            margin-bottom: 1rem;
            font-weight: 700;
        }
        .header p { 
            font-size: 1.2rem; 
            opacity: 0.9;
            max-width: 600px;
            margin: 0 auto;
        }
        .content { 
            padding: 2rem; 
        }
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin: 2rem 0;
        }
        .summary-card {
            background: white;
            padding: 1.5rem;
            border-radius: 8px;
            border-left: 4px solid #667eea;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .summary-card.winner {
            border-left-color: #10b981;
            background: #f0fdf4;
        }
        .products-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin: 2rem 0;
        }
        .product-card {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            overflow: hidden;
            background: white;
        }
        .product-header {
            background: #f8fafc;
            padding: 1.5rem;
            text-align: center;
            border-bottom: 1px solid #e2e8f0;
        }
        .product-image {
            max-width: 200px;
            height: auto;
            margin: 0 auto 1rem;
        }
        .product-info {
            padding: 1.5rem;
        }
        .specs-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1rem 0;
        }
        .specs-table th, .specs-table td {
            padding: 0.75rem;
            border: 1px solid #e2e8f0;
            text-align: left;
        }
        .specs-table th {
            background: #f8fafc;
            font-weight: 600;
        }
        .affiliate-btn {
            display: inline-block;
            background: #3b82f6;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 1rem 0;
            transition: background 0.3s;
        }
        .affiliate-btn:hover {
            background: #2563eb;
        }
        .pros-cons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin: 1rem 0;
        }
        .pros, .cons {
            padding: 1rem;
            border-radius: 6px;
        }
        .pros { background: #f0fdf4; border: 1px solid #bbf7d0; }
        .cons { background: #fef2f2; border: 1px solid #fecaca; }
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            margin: 2rem 0;
            background: white;
        }
        .comparison-table th {
            background: #3b82f6;
            color: white;
            padding: 1rem;
            text-align: left;
        }
        .comparison-table td {
            padding: 1rem;
            border: 1px solid #e2e8f0;
        }
        .video-wrapper {
            position: relative;
            width: 100%;
            height: 0;
            padding-bottom: 56.25%;
            margin: 1rem 0;
        }
        .video-wrapper iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: none;
            border-radius: 8px;
        }
        .related-section {
            margin: 3rem 0;
            padding: 2rem;
            background: #f8fafc;
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
            border: 1px solid #e2e8f0;
            transition: transform 0.3s;
        }
        .related-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .footer {
            text-align: center;
            padding: 2rem;
            color: #64748b;
            border-top: 1px solid #e2e8f0;
        }
        @media (max-width: 768px) {
            .header h1 { font-size: 2rem; }
            .pros-cons { grid-template-columns: 1fr; }
            .products-grid { grid-template-columns: 1fr; }
            .related-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(description)}</p>
        </header>
        
        <main class="content">
            <!-- Winner Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card ${winners.overall ? 'winner' : ''}">
                    <h3>🏆 Overall Winner</h3>
                    <p style="font-size: 1.2rem; font-weight: bold; margin: 0.5rem 0;">${winners.overall || products[0] || 'Check Comparison'}</p>
                    <p style="color: #666;">${winners.overallDescription || 'Best all-around choice for most users'}</p>
                </div>
                
                <div class="summary-card ${winners.budget ? 'winner' : ''}">
                    <h3>💰 Best Value</h3>
                    <p style="font-size: 1.2rem; font-weight: bold; margin: 0.5rem 0;">${winners.budget || products[1] || products[0] || 'Check Comparison'}</p>
                    <p style="color: #666;">${winners.budgetDescription || 'Great performance at competitive price'}</p>
                </div>
                
                <div class="summary-card ${winners.performance ? 'winner' : ''}">
                    <h3>⚡ Performance King</h3>
                    <p style="font-size: 1.2rem; font-weight: bold; margin: 0.5rem 0;">${winners.performance || products[0] || 'Check Comparison'}</p>
                    <p style="color: #666;">${winners.performanceDescription || 'Top-tier performance for power users'}</p>
                </div>
            </div>
            
            ${htmlContent}
            
            ${relatedComparisons.length > 0 ? `
            <section class="related-section">
                <h2>Related Comparisons</h2>
                <div class="related-grid">
                    ${relatedComparisons.map(comp => `
                        <a href="/comparison/${comp.slug}" class="related-card">
                            <h3>${escapeHtml(comp.title)}</h3>
                            <p>${escapeHtml(comp.description || '')}</p>
                            <small>${comp.products.join(' vs ')}</small>
                        </a>
                    `).join('')}
                </div>
            </section>
            ` : ''}
        </main>
        
        <footer class="footer">
            <p>&copy; ${new Date().getFullYear()} ReviewIndex. All rights reserved.</p>
            <p><small>Last updated: ${frontmatter.date ? new Date(frontmatter.date).toLocaleDateString() : 'Recently'}</small></p>
        </footer>
    </div>
</body>
</html>`;
}

function convertContentToHTML(content) {
    let html = content;

    // Preserve iframes (videos)
    html = html.replace(/<iframe[^>]*><\/iframe>/g, (iframe) => {
        return `<div class="video-wrapper">${iframe}</div>`;
    });

    // Convert headers
    html = html.replace(/### (.*?)\n/g, '<h3>$1</h3>');
    html = html.replace(/## (.*?)\n/g, '<h2>$1</h2>');

    // Convert bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Convert images
    html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" class="product-image" loading="lazy">');

    // Convert affiliate buttons
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)\{: \.btn \.btn-primary\}/g, '<a href="$2" class="affiliate-btn" target="_blank" rel="nofollow sponsored">$1</a>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)\{: \.btn \.btn-sm\}/g, '<a href="$2" class="affiliate-btn" target="_blank" rel="nofollow sponsored">$1</a>');

    // Convert regular links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Convert markdown tables to HTML tables
    html = html.replace(/\|([^\n]+)\|\n\|([^\n]+)\|\n((?:\|[^\n]+\|\n)*)/g, (match, header, separator, rows) => {
        const headerCells = header.split('|').map(cell => `<th>${cell.trim()}</th>`).join('');
        const rowLines = rows.trim().split('\n');
        const tableRows = rowLines.map(row => {
            const cells = row.split('|').map(cell => `<td>${cell.trim()}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
        
        return `<table class="comparison-table"><thead><tr>${headerCells}</tr></thead><tbody>${tableRows}</tbody></table>`;
    });

    // Convert pros/cons lists
    html = html.replace(/✅ ([^\n]+)/g, '<li>$1</li>');
    html = html.replace(/❌ ([^\n]+)/g, '<li>$1</li>');
    
    // Wrap pros/cons in proper containers
    html = html.replace(/#### Pros\n((?:<li>.*<\/li>\n?)+)/g, '<div class="pros-cons"><div class="pros"><h4>Pros</h4><ul>$1</ul></div>');
    html = html.replace(/#### Cons\n((?:<li>.*<\/li>\n?)+)/g, '<div class="cons"><h4>Cons</h4><ul>$1</ul></div></div>');

    // Add line breaks and paragraphs
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    html = '<p>' + html + '</p>';

    return html;
}

function generateSchemaMarkup(frontmatter, slug, products, winners) {
    return JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        "name": frontmatter.title,
        "description": frontmatter.description,
        "image": frontmatter.featured_image,
        "brand": {
            "@type": "Brand", 
            "name": "Multiple Brands"
        },
        "offers": {
            "@type": "AggregateOffer",
            "offerCount": products.length,
            "lowPrice": "12",
            "highPrice": "22", 
            "priceCurrency": "USD"
        }
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderNotFoundPage() {
    return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Not Found - ReviewIndex</title>
            <meta name="robots" content="noindex">
        </head>
        <body style="font-family: sans-serif; text-align: center; padding: 2rem;">
            <h1>Comparison Not Found</h1>
            <p>The requested product comparison could not be found.</p>
            <a href="/">Return Home</a>
        </body>
        </html>
    `, { status: 404 });
}

function renderErrorPage() {
    return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Error - ReviewIndex</title>
            <meta name="robots" content="noindex">
        </head>
        <body style="font-family: sans-serif; text-align: center; padding: 2rem;">
            <h1>Server Error</h1>
            <p>An error occurred while loading the comparison.</p>
            <a href="/">Return Home</a>
        </body>
        </html>
    `, { status: 500 });
}
