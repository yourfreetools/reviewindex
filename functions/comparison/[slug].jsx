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

        // Get related comparisons
        const relatedComparisons = await fetchRelatedComparisons(slug, env.GITHUB_TOKEN);

        // Convert markdown to HTML and render the comparison page
        const htmlContent = await renderComparisonPage(comparisonContent, slug, request.url, relatedComparisons);
        
        // Create response with 6-month cache headers
        return new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=15552000, immutable', // 6 months
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
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

async function fetchRelatedComparisons(currentSlug, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        // Get list of all comparison files
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/comparisons`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App'
                }
            }
        );

        if (response.status === 200) {
            const files = await response.json();
            const comparisons = [];
            
            // Get up to 3 random comparisons (excluding current)
            const otherFiles = files
                .filter(file => file.name.endsWith('.md') && file.name !== `${currentSlug}.md`)
                .sort(() => 0.5 - Math.random())
                .slice(0, 3);

            // Fetch frontmatter for each related comparison
            for (const file of otherFiles) {
                try {
                    const fileResponse = await fetch(file.download_url);
                    if (fileResponse.status === 200) {
                        const content = await fileResponse.text();
                        const { frontmatter } = parseComparisonMarkdown(content);
                        comparisons.push({
                            slug: file.name.replace('.md', ''),
                            title: frontmatter.title,
                            description: frontmatter.description,
                            products: frontmatter.comparison_products || []
                        });
                    }
                } catch (error) {
                    console.error(`Error processing related comparison ${file.name}:`, error);
                }
            }
            
            return comparisons;
        }
        return [];
    } catch (error) {
        console.error('Error fetching related comparisons:', error);
        return [];
    }
}

async function renderComparisonPage(markdownContent, slug, requestUrl, relatedComparisons) {
    // Parse frontmatter and content
    const { frontmatter, content } = parseComparisonMarkdown(markdownContent);
    
    // Convert markdown to HTML with proper formatting
    const htmlContent = convertComparisonMarkdownToHTML(content);
    
    // Generate canonical URL
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    
    // Get products from frontmatter
    const products = frontmatter.comparison_products || [];
    
    // Generate schema markup
    const schemaMarkup = generateComparisonSchema(frontmatter, slug, canonicalUrl, products);
    
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
    <meta property="og:image" content="${escapeHtml(frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-image.jpg')}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}">
    <meta name="twitter:description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`)}">
    <meta name="twitter:image" content="${escapeHtml(frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-image.jpg')}">
    
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
            background: #f8fafc;
            min-height: 100vh;
        }
        
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 0 20px;
        }
        
        /* Header Styles */
        .header { 
            background: white;
            padding: 3rem 2rem;
            text-align: center;
            border-radius: 20px;
            box-shadow: var(--shadow);
            margin: 2rem 0;
            border: 1px solid var(--border);
        }
        
        .header h1 {
            font-size: clamp(1.8rem, 4vw, 2.5rem);
            margin-bottom: 1rem;
            color: var(--dark);
            line-height: 1.2;
            font-weight: 700;
        }
        
        .header .description {
            font-size: 1.2rem;
            color: #64748b;
            max-width: 800px;
            margin: 0 auto;
        }
        
        /* Quick Summary Cards */
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
            margin: 2rem 0;
        }
        
        .summary-card {
            background: white;
            padding: 2rem;
            border-radius: 16px;
            box-shadow: var(--shadow);
            text-align: center;
            border: 1px solid var(--border);
            transition: transform 0.2s ease;
        }
        
        .summary-card:hover {
            transform: translateY(-4px);
        }
        
        .summary-card.winner {
            border-left: 6px solid var(--success);
        }
        
        .summary-card h3 {
            font-size: 1.1rem;
            margin-bottom: 1rem;
            color: var(--dark);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
        }
        
        /* Main Content Sections */
        .content-section {
            background: white;
            border-radius: 16px;
            padding: 2.5rem;
            margin: 2rem 0;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
        }
        
        .section-title {
            font-size: 1.8rem;
            margin-bottom: 1.5rem;
            color: var(--dark);
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        /* Related Comparisons Section */
        .related-section {
            background: white;
            border-radius: 16px;
            padding: 2.5rem;
            margin: 3rem 0;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
        }
        
        .related-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-top: 1.5rem;
        }
        
        .related-card {
            background: var(--light);
            border-radius: 12px;
            padding: 1.5rem;
            transition: all 0.3s ease;
            border: 1px solid var(--border);
            text-decoration: none;
            color: inherit;
            display: block;
        }
        
        .related-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
            background: white;
        }
        
        .related-card h4 {
            color: var(--dark);
            margin-bottom: 0.5rem;
            font-size: 1.1rem;
            line-height: 1.4;
        }
        
        .related-card p {
            color: #64748b;
            font-size: 0.9rem;
            line-height: 1.5;
            margin-bottom: 1rem;
        }
        
        .related-products {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-top: 0.5rem;
        }
        
        .related-badge {
            background: var(--primary-light);
            color: var(--primary-dark);
            padding: 0.2rem 0.6rem;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 500;
        }
        
        .related-vs {
            color: var(--gray-500);
            font-weight: 700;
            font-size: 0.8rem;
        }
        
        /* Comparison Table */
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            font-size: 0.95rem;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: var(--shadow);
        }
        
        .comparison-table th {
            background: var(--light);
            padding: 1rem;
            text-align: left;
            font-weight: 600;
            color: var(--dark);
            border: 1px solid var(--border);
        }
        
        .comparison-table td {
            padding: 1rem;
            border: 1px solid var(--border);
            vertical-align: top;
        }
        
        .comparison-table .feature-cell {
            background: var(--light);
            font-weight: 600;
            color: var(--dark);
            width: 200px;
        }
        
        /* Product Cards */
        .products-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin: 2rem 0;
        }
        
        .product-card {
            background: white;
            border-radius: 12px;
            padding: 2rem;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
        }
        
        .product-header {
            text-align: center;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 2px solid var(--border);
        }
        
        .product-header h3 {
            font-size: 1.4rem;
            color: var(--dark);
            margin-bottom: 0.5rem;
        }
        
        /* Images and Media */
        .content-image {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
            margin: 1rem 0;
            display: block;
        }
        
        /* YouTube Embed */
        .video-embed {
            margin: 2rem 0;
            text-align: center;
        }
        
        .video-wrapper {
            position: relative;
            width: 100%;
            height: 0;
            padding-bottom: 56.25%;
            margin: 1.5rem 0;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        }
        
        .video-wrapper iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: none;
        }
        
        /* Buttons */
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
            font-size: 0.9rem;
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
        
        /* Pros/Cons Lists */
        .pros-cons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin: 1.5rem 0;
        }
        
        @media (max-width: 768px) {
            .pros-cons {
                grid-template-columns: 1fr;
            }
        }
        
        .pros-list, .cons-list {
            padding: 1.5rem;
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
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        /* Markdown Content Styling */
        .markdown-content h2 {
            font-size: 1.6rem;
            margin: 2.5rem 0 1rem 0;
            color: var(--dark);
            padding-bottom: 0.5rem;
            border-bottom: 2px solid var(--border);
        }
        
        .markdown-content h3 {
            font-size: 1.3rem;
            margin: 2rem 0 1rem 0;
            color: var(--dark);
        }
        
        .markdown-content h4 {
            font-size: 1.1rem;
            margin: 1.5rem 0 0.75rem 0;
            color: var(--dark);
        }
        
        .markdown-content p {
            margin-bottom: 1rem;
            line-height: 1.7;
            color: #4b5563;
        }
        
        .markdown-content ul, .markdown-content ol {
            margin: 1rem 0;
            padding-left: 2rem;
        }
        
        .markdown-content li {
            margin-bottom: 0.5rem;
            line-height: 1.6;
        }
        
        .markdown-content strong {
            font-weight: 600;
            color: var(--dark);
        }
        
        .markdown-content em {
            font-style: italic;
            color: #6b7280;
        }
        
        .markdown-content blockquote {
            border-left: 4px solid var(--primary);
            padding: 1rem 1.5rem;
            margin: 1.5rem 0;
            background: var(--light);
            border-radius: 0 8px 8px 0;
            font-style: italic;
        }
        
        .markdown-content code {
            background: #f3f4f6;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
            color: #dc2626;
        }
        
        .markdown-content pre {
            background: #1f2937;
            color: #f9fafb;
            padding: 1.5rem;
            border-radius: 8px;
            overflow-x: auto;
            margin: 1.5rem 0;
            font-size: 0.9rem;
        }
        
        .markdown-content pre code {
            background: none;
            padding: 0;
            color: inherit;
        }
        
        /* Footer */
        .footer {
            text-align: center;
            padding: 3rem 2rem;
            color: #64748b;
            margin-top: 3rem;
            border-top: 1px solid var(--border);
        }
        
        .back-link {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--primary);
            text-decoration: none;
            font-weight: 600;
            margin: 2rem 0;
            padding: 0.75rem 1.5rem;
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
                padding: 0 15px;
            }
            
            .header {
                padding: 2rem 1rem;
            }
            
            .content-section {
                padding: 1.5rem;
            }
            
            .summary-cards {
                grid-template-columns: 1fr;
            }
            
            .products-grid {
                grid-template-columns: 1fr;
            }
            
            .related-grid {
                grid-template-columns: 1fr;
            }
            
            .comparison-table {
                font-size: 0.85rem;
            }
            
            .comparison-table th,
            .comparison-table td {
                padding: 0.75rem 0.5rem;
            }
        }
        
        @media (max-width: 480px) {
            .comparison-table {
                display: block;
                overflow-x: auto;
            }
            
            .related-products {
                flex-direction: column;
                align-items: flex-start;
                gap: 0.3rem;
            }
            
            .related-vs {
                display: none;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header" role="banner">
            <h1>${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}</h1>
            ${frontmatter.description ? `<p class="description">${escapeHtml(frontmatter.description)}</p>` : ''}
        </header>
        
        <main role="main">
            <!-- Quick Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card winner">
                    <h3>🏆 Overall Winner</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--success); margin: 0.5rem 0;">Check Comparison</p>
                    <p style="color: #64748b;">Best all-around choice for most users</p>
                </div>
                
                <div class="summary-card">
                    <h3>💰 Best Value</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--warning); margin: 0.5rem 0;">Check Comparison</p>
                    <p style="color: #64748b;">Great performance at competitive price</p>
                </div>
                
                <div class="summary-card">
                    <h3>⚡ Performance</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--primary); margin: 0.5rem 0;">Check Comparison</p>
                    <p style="color: #64748b;">Top-tier performance for power users</p>
                </div>
            </div>
            
            <!-- Main Content -->
            <div class="content-section">
                <div class="markdown-content">
                    ${htmlContent}
                </div>
            </div>
            
            <!-- Related Comparisons -->
            ${relatedComparisons.length > 0 ? `
            <section class="related-section" aria-labelledby="related-title">
                <h2 class="section-title" id="related-title">🔗 Related Comparisons</h2>
                <p style="color: #64748b; margin-bottom: 1.5rem;">You might also be interested in these comparisons</p>
                <div class="related-grid">
                    ${relatedComparisons.map(comp => `
                        <a href="/comparison/${comp.slug}" class="related-card" aria-label="Read comparison: ${escapeHtml(comp.title)}">
                            <h4>${escapeHtml(comp.title)}</h4>
                            <p>${escapeHtml(comp.description || 'Detailed side-by-side comparison')}</p>
                            ${comp.products.length > 0 ? `
                            <div class="related-products">
                                ${comp.products.map((product, index) => `
                                    <span class="related-badge">${escapeHtml(product)}</span>
                                    ${index < comp.products.length - 1 ? '<span class="related-vs">vs</span>' : ''}
                                `).join('')}
                            </div>
                            ` : ''}
                        </a>
                    `).join('')}
                </div>
            </section>
            ` : ''}
            
            <!-- Back Link -->
            <div style="text-align: center;">
                <a href="/comparisons" class="back-link">← View All Comparisons</a>
            </div>
        </main>
        
        <footer class="footer" role="contentinfo">
            <p>© ${new Date().getFullYear()} ReviewIndex. All comparisons are independently researched.</p>
            <p>Last updated: ${frontmatter.date || 'Recently'}</p>
        </footer>
    </div>
    
    <script>
        // Make images responsive
        document.addEventListener('DOMContentLoaded', function() {
            // Handle images
            const images = document.querySelectorAll('.markdown-content img');
            images.forEach(img => {
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
                img.style.borderRadius = '8px';
                img.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
            });
            
            // Handle videos
            const iframes = document.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                iframe.style.width = '100%';
                iframe.style.minHeight = '400px';
            });
            
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
        });
    </script>
</body>
</html>`;
}

// ... (keep all the existing helper functions: parseComparisonMarkdown, convertComparisonMarkdownToHTML, 
// generateComparisonSchema, formatComparisonSlug, escapeHtml, renderErrorPage from the previous code)

// Add the helper functions that are missing from the previous code
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
    let html = markdown;
    
    // Clean up any visible code snippets or markdown artifacts
    html = html
        // Remove visible code blocks and markdown artifacts
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '')
        .replace(/{:\s*[^}]*}/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="content-image" loading="lazy">');
    
    // Process tables
    html = html.replace(/\|([^\n]+)\|\n\|([^\n]+)\|\n((?:\|[^\n]+\|\n?)+)/g, function(match, headers, separators, rows) {
        const headerCells = headers.split('|').map(cell => cell.trim()).filter(cell => cell);
        const rowLines = rows.trim().split('\n');
        
        let tableHTML = '<table class="comparison-table">\n<thead>\n<tr>';
        
        // Add headers
        headerCells.forEach(header => {
            tableHTML += `<th>${cleanCellContent(header)}</th>`;
        });
        tableHTML += '</tr>\n</thead>\n<tbody>';
        
        // Add rows
        rowLines.forEach(line => {
            const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
            if (cells.length > 0) {
                tableHTML += '<tr>';
                cells.forEach((cell, index) => {
                    const cellClass = index === 0 ? 'feature-cell' : '';
                    tableHTML += `<td class="${cellClass}">${cleanCellContent(cell)}</td>`;
                });
                tableHTML += '</tr>';
            }
        });
        
        tableHTML += '</tbody>\n</table>';
        return tableHTML;
    });
    
    // Convert headings
    html = html
        .replace(/^# (.*)$/gm, '<h2>$1</h2>')
        .replace(/^## (.*)$/gm, '<h3>$1</h3>')
        .replace(/^### (.*)$/gm, '<h4>$1</h4>');
    
    // Convert lists
    html = html.replace(/^- (.*)$/gm, '<li>$1</li>')
               .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    // Convert paragraphs
    const lines = html.split('\n');
    let processedLines = [];
    let inList = false;
    
    for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (inList) inList = false;
            continue;
        }
        
        if (trimmed.startsWith('<') || trimmed.startsWith('|') || trimmed.startsWith('- ') || trimmed.startsWith('<li>')) {
            processedLines.push(trimmed);
            if (trimmed.startsWith('<li>')) inList = true;
        } else if (!inList && !trimmed.startsWith('#') && !trimmed.startsWith('<')) {
            processedLines.push(`<p>${trimmed}</p>`);
        } else {
            processedLines.push(trimmed);
        }
    }
    
    html = processedLines.join('\n');
    
    return html;
}

function cleanCellContent(content) {
    return content
        .replace(/{:\s*[^}]*}/g, '')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '<a href="$2" target="_blank">$1</a>')
        .trim();
}

function generateComparisonSchema(frontmatter, slug, canonicalUrl, products) {
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
            "name": "ReviewIndex"
        },
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": canonicalUrl
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
        <a href="/comparisons">← Return to Comparisons</a>
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
