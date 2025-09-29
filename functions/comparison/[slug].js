// functions/comparison/[...slug].js
export async function onRequest(context) {
    const { request, params, env } = context;
    const slug = params.slug;
    
    // Generate cache key for the entire page
    const cacheKey = new Request(request.url, request);
    const cache = caches.default;
    
    // Try to get from cache first
    let response = await cache.match(cacheKey);
    if (response) {
        console.log('✅ COMPARISON PAGE Cache HIT for:', slug);
        return response;
    }
    console.log('🔄 COMPARISON PAGE Cache MISS for:', slug);
    
    try {
        // If it's a direct file request for .md, redirect to proper URL
        if (slug.endsWith('.md')) {
            const cleanSlug = slug.replace('.md', '');
            return Response.redirect(`${new URL(request.url).origin}/comparison/${cleanSlug}`, 301);
        }

        // Fetch the comparison content
        const comparisonContent = await fetchComparisonContent(slug, env.GITHUB_TOKEN);
        
        if (!comparisonContent) {
            return renderComparisonErrorPage('Comparison not found', 'The requested comparison could not be found.');
        }

        // Parse comparison markdown
        const { frontmatter: comparisonFrontmatter, content } = parseComparisonMarkdown(comparisonContent);
        
        // Convert markdown to HTML with comparison-specific processing
        const htmlContent = convertComparisonMarkdownToHTML(content);
        
        // Get related comparisons
        const relatedComparisons = await findRelatedComparisonsFromGitHub(
            comparisonFrontmatter, 
            slug, 
            env.GITHUB_TOKEN
        );

        // Render the comparison page
        const fullHtml = await renderComparisonPage(
            comparisonFrontmatter,
            htmlContent, 
            slug, 
            request.url, 
            relatedComparisons
        );
        
        // Create response with cache headers
        response = new Response(fullHtml, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'Cache-Control': 'public, max-age=15552000' // 6 months in seconds
            }
        });
        
        // Store in cache for future requests
        context.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

    } catch (error) {
        console.error('Error rendering comparison page:', error);
        return renderComparisonErrorPage('Server Error', 'An error occurred while loading the comparison.');
    }
}

// ==================== COMPARISON-SPECIFIC FUNCTIONS ====================

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

function parseComparisonMarkdown(content) {
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
                    const key = line.substring(0, colon).trim();
                    let value = line.substring(colon + 1).trim();
                    
                    // Handle different value types
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith("'") && value.endsWith("'")) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith('[') && value.endsWith(']')) {
                        value = value.substring(1, value.length - 1).split(',').map(item => item.trim().replace(/["']/g, ''));
                    } else if (value === 'true') {
                        value = true;
                    } else if (value === 'false') {
                        value = false;
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

    // Process comparison table specifically
    html = html.replace(/## 📋 Detailed Comparison Table[\s\S]*?(?=## |$)/g, (match) => {
        return processComparisonTable(match);
    });

    // Process quick verdict section
    html = html.replace(/### 🏆 Quick Verdict[\s\S]*?(?=## |$)/g, (match) => {
        return processQuickVerdict(match);
    });

    // Process product analysis sections
    html = html.replace(/---\s*### ([^\n]+)[\s\S]*?(?=---|$)/g, (match) => {
        return processProductAnalysis(match);
    });

    // Standard markdown conversions
    html = html
        .replace(/^# (.*)$/gm, '<h2>$1</h2>')
        .replace(/^## (.*)$/gm, '<h3>$1</h3>')
        .replace(/^### (.*)$/gm, '<h4>$1</h4>')
        .replace(/^#### (.*)$/gm, '<h5>$1</h5>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy" class="content-image">')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Process lists
    const lines = html.split('\n');
    let inList = false;
    let listItems = [];
    let processedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (!line) {
            if (inList && listItems.length > 0) {
                processedLines.push(`<ul>${listItems.join('')}</ul>`);
                listItems = [];
                inList = false;
            }
            continue;
        }

        if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\./.test(line)) {
            if (!inList) inList = true;
            const listItemContent = line.replace(/^(- |\* |\d+\.)/, '').trim();
            listItems.push(`<li>${listItemContent}</li>`);
        } else {
            if (inList && listItems.length > 0) {
                processedLines.push(`<ul>${listItems.join('')}</ul>`);
                listItems = [];
                inList = false;
            }
            
            if (line.startsWith('<') || line.match(/^<[^>]+>$/)) {
                processedLines.push(line);
            } else {
                processedLines.push(`<p>${line}</p>`);
            }
        }
    }

    if (inList && listItems.length > 0) {
        processedLines.push(`<ul>${listItems.join('')}</ul>`);
    }

    html = processedLines.join('\n');

    // Clean up
    html = html
        .replace(/<p><\/p>/g, '')
        .replace(/(<\/h[2-5]>)\s*<p>/g, '$1')
        .replace(/<\/p>\s*(<h[2-5]>)/g, '$1')
        .replace(/<p>(<ul>.*?<\/ul>)<\/p>/g, '$1')
        .replace(/<p>(<blockquote>.*?<\/blockquote>)<\/p>/g, '$1');

    return html;
}

function processComparisonTable(tableSection) {
    const lines = tableSection.split('\n');
    let inTable = false;
    let headers = [];
    let rows = [];
    let currentRow = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
            inTable = true;
            const cells = trimmedLine.split('|').slice(1, -1).map(cell => cell.trim());
            
            if (cells.length > 0) {
                if (headers.length === 0 && !cells[0].includes('---')) {
                    headers = cells;
                } else if (cells[0].includes('---')) {
                    // Skip separator row
                    continue;
                } else {
                    currentRow = cells;
                    rows.push([...currentRow]);
                }
            }
        } else if (inTable && trimmedLine && !trimmedLine.startsWith('|')) {
            // End of table
            break;
        }
    }

    if (headers.length === 0 || rows.length === 0) {
        return tableSection; // Return original if parsing fails
    }

    let tableHTML = `
    <div class="comparison-table-container">
        <table class="comparison-table" aria-label="Detailed product comparison">
            <thead>
                <tr>
    `;
    
    headers.forEach(header => {
        tableHTML += `<th scope="col">${escapeHtml(header)}</th>`;
    });
    
    tableHTML += `
                </tr>
            </thead>
            <tbody>
    `;
    
    rows.forEach(row => {
        tableHTML += '<tr>';
        row.forEach((cell, index) => {
            const isFirstCell = index === 0;
            const cellTag = isFirstCell ? 'th scope="row"' : 'td';
            
            // Process special content like ratings, prices, etc.
            let processedCell = cell;
            if (cell.includes('⭐⭐⭐⭐⭐')) {
                processedCell = cell.replace('⭐⭐⭐⭐⭐', '<span class="rating-stars">★★★★★</span> 5/5');
            } else if (cell.includes('⭐⭐⭐')) {
                processedCell = cell.replace('⭐⭐⭐', '<span class="rating-stars">★★★☆☆</span> 3/5');
            } else if (cell.includes('$')) {
                processedCell = `<span class="price">${cell}</span>`;
            } else if (cell.includes('✅')) {
                processedCell = cell.replace('✅', '<span class="pro-icon">✓</span>');
            } else if (cell.includes('❌')) {
                processedCell = cell.replace('❌', '<span class="con-icon">✗</span>');
            }
            
            tableHTML += `<${cellTag}>${processedCell}</${isFirstCell ? 'th' : 'td'}>`;
        });
        tableHTML += '</tr>';
    });
    
    tableHTML += `
            </tbody>
        </table>
    </div>
    `;
    
    return tableSection.replace(/\|.*\|[\s\S]*?(?=## |$)/, tableHTML);
}

function processQuickVerdict(verdictSection) {
    const lines = verdictSection.split('\n');
    let verdictHTML = '<div class="quick-verdict">';
    
    lines.forEach(line => {
        const trimmedLine = line.trim();
        
        if (trimmedLine.startsWith('🏆') || trimmedLine.startsWith('💰') || trimmedLine.startsWith('⚡')) {
            verdictHTML += `<div class="verdict-item">
                <div class="verdict-icon">${trimmedLine.split(' ')[0]}</div>
                <div class="verdict-content">
                    <strong>${trimmedLine.split('**').filter((_, i) => i % 2 === 1).join('</strong>')}</strong>
                    <p>${trimmedLine.split('*').pop()}</p>
                </div>
            </div>`;
        }
    });
    
    verdictHTML += '</div>';
    return verdictSection.replace(/### 🏆 Quick Verdict[\s\S]*?(?=## |$)/, verdictHTML);
}

function processProductAnalysis(analysisSection) {
    // Extract product name and content
    const productMatch = analysisSection.match(/### ([^\n]+)/);
    if (!productMatch) return analysisSection;
    
    const productName = productMatch[1];
    const content = analysisSection.replace(/### [^\n]+\n/, '');
    
    return `
    <section class="product-analysis" aria-labelledby="${slugify(productName)}-analysis">
        <h3 id="${slugify(productName)}-analysis">${productName}</h3>
        ${convertStandardMarkdown(content)}
    </section>
    `;
}

function convertStandardMarkdown(content) {
    return content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
}

function slugify(text) {
    return text.toLowerCase().replace(/[^\w]+/g, '-');
}

// ==================== RELATED COMPARISONS ====================

async function findRelatedComparisonsFromGitHub(currentFrontmatter, currentSlug, githubToken) {
    try {
        const allComparisons = await fetchAllComparisonsMetadata(githubToken);
        if (!allComparisons || allComparisons.length === 0) return [];

        const currentComparisonCategories = normalizeCategories(currentFrontmatter.categories);
        const related = [];

        for (const comparison of allComparisons) {
            if (comparison.slug === currentSlug) continue;
            
            const comparisonCategories = normalizeCategories(comparison.categories);
            const matchingCategories = findMatchingCategories(currentComparisonCategories, comparisonCategories);
            
            if (matchingCategories.length > 0) {
                related.push({
                    title: comparison.title || formatSlug(comparison.slug),
                    slug: comparison.slug,
                    description: comparison.description || '',
                    image: comparison.image || '/default-comparison-thumbnail.jpg',
                    categories: matchingCategories,
                    matchCount: matchingCategories.length
                });
                
                if (related.length >= 3) break;
            }
        }

        console.log('📊 Found', related.length, 'related comparisons for:', currentSlug);
        return related;

    } catch (error) {
        console.error('Error fetching related comparisons from GitHub:', error);
        return [];
    }
}

async function fetchAllComparisonsMetadata(githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/comparisons`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (response.status === 200) {
            const files = await response.json();
            const markdownFiles = files.filter(file => file.name.endsWith('.md'));
            
            const comparisonsMetadata = [];
            
            for (const file of markdownFiles.slice(0, 15)) {
                try {
                    const slug = file.name.replace('.md', '');
                    const contentResponse = await fetch(
                        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/comparisons/${file.name}`,
                        {
                            headers: {
                                'Authorization': `token ${githubToken}`,
                                'User-Agent': 'Review-Index-App',
                                'Accept': 'application/vnd.github.v3.raw'
                            }
                        }
                    );
                    
                    if (contentResponse.status === 200) {
                        const content = await contentResponse.text();
                        const firstLines = content.split('\n').slice(0, 15).join('\n');
                        const { frontmatter } = parseComparisonMarkdown(firstLines + '\n---\n');
                        
                        comparisonsMetadata.push({
                            slug: slug,
                            title: frontmatter.title,
                            description: frontmatter.description,
                            image: frontmatter.featured_image,
                            categories: frontmatter.categories
                        });
                    }
                } catch (error) {
                    console.error('Error processing comparison file:', file.name, error);
                    continue;
                }
            }
            
            return comparisonsMetadata;
        }
        
        return [];
        
    } catch (error) {
        console.error('Error fetching comparisons metadata:', error);
        return [];
    }
}

// ==================== SCHEMA & RENDERING ====================

function generateComparisonSchemaMarkup(frontmatter, slug, url) {
    const comparisonProducts = frontmatter.comparison_products || [];
    
    return JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": frontmatter.title || formatSlug(slug),
        "description": frontmatter.description || 'Detailed product comparison and analysis',
        "image": frontmatter.featured_image || '',
        "datePublished": frontmatter.date || new Date().toISOString(),
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
        "mainEntity": {
            "@type": "ItemList",
            "numberOfItems": comparisonProducts.length,
            "itemListElement": comparisonProducts.map((product, index) => ({
                "@type": "ListItem",
                "position": index + 1,
                "item": {
                    "@type": "Product",
                    "name": product
                }
            }))
        }
    }, null, 2);
}

async function renderComparisonPage(frontmatter, htmlContent, slug, requestUrl, relatedComparisons = []) {
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    const schemaMarkup = generateComparisonSchemaMarkup(frontmatter, slug, canonicalUrl);
    const socialImage = frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-social.jpg';

    const relatedComparisonsHTML = generateRelatedComparisonsHTML(relatedComparisons, frontmatter.categories);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(frontmatter.title || formatSlug(slug))} - ReviewIndex</title>
    <meta name="description" content="${escapeHtml(frontmatter.description || 'Detailed product comparison and analysis')}">
    <link rel="canonical" href="${canonicalUrl}">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(frontmatter.title || formatSlug(slug))}">
    <meta property="og:description" content="${escapeHtml(frontmatter.description || 'Detailed product comparison and analysis')}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${escapeHtml(socialImage)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(frontmatter.title || formatSlug(slug))}">
    <meta name="twitter:description" content="${escapeHtml(frontmatter.description || 'Detailed product comparison and analysis')}">
    <meta name="twitter:image" content="${escapeHtml(socialImage)}">
    <meta name="twitter:image:alt" content="${escapeHtml(frontmatter.title || formatSlug(slug))} product comparison">
    
    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    ${schemaMarkup}
    </script>
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', system-ui, sans-serif; 
            line-height: 1.6; 
            color: #333;
            background: #f8fafc;
            padding: 20px;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 40px; 
            background: white;
            min-height: 100vh;
            box-shadow: 0 0 30px rgba(0,0,0,0.1);
            border-radius: 12px;
        }
        .header { 
            text-align: center; 
            padding: 2rem 0; 
            border-bottom: 2px solid #f0f0f0;
            margin-bottom: 2rem;
        }
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            color: #1a202c;
            line-height: 1.2;
        }
        .content { 
            font-size: 1.1rem; 
            line-height: 1.8;
            color: #2d3748;
        }
        
        /* Comparison Table Styles */
        .comparison-table-container {
            margin: 3rem 0;
            overflow-x: auto;
            background: #f8fafc;
            padding: 2rem;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
        }
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }
        .comparison-table th,
        .comparison-table td {
            padding: 1.25rem;
            text-align: left;
            border-bottom: 1px solid #e2e8f0;
        }
        .comparison-table th {
            background: #1e40af;
            color: white;
            font-weight: 600;
            font-size: 1.1rem;
        }
        .comparison-table tr:last-child td {
            border-bottom: none;
        }
        .comparison-table tr:hover {
            background: #f8fafc;
        }
        .comparison-table th:first-child {
            border-radius: 8px 0 0 0;
        }
        .comparison-table th:last-child {
            border-radius: 0 8px 0 0;
        }
        
        /* Quick Verdict Styles */
        .quick-verdict {
            background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
            padding: 2.5rem;
            border-radius: 12px;
            margin: 2rem 0;
            border-left: 4px solid #0369a1;
        }
        .verdict-item {
            display: flex;
            align-items: flex-start;
            gap: 1rem;
            margin-bottom: 1.5rem;
            padding: 1rem;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .verdict-item:last-child {
            margin-bottom: 0;
        }
        .verdict-icon {
            font-size: 1.5rem;
            flex-shrink: 0;
        }
        .verdict-content strong {
            color: #1e40af;
            font-size: 1.1rem;
            display: block;
            margin-bottom: 0.5rem;
        }
        
        /* Product Analysis Styles */
        .product-analysis {
            background: #fef7ed;
            padding: 2rem;
            border-radius: 12px;
            margin: 2rem 0;
            border: 2px solid #fed7aa;
        }
        .product-analysis h3 {
            color: #92400e;
            margin-bottom: 1.5rem;
            font-size: 1.5rem;
            border-bottom: 2px solid #fdba74;
            padding-bottom: 0.5rem;
        }
        
        /* Rating and Icon Styles */
        .rating-stars {
            color: #f59e0b;
            font-weight: bold;
        }
        .price {
            color: #059669;
            font-weight: 600;
            font-size: 1.1rem;
        }
        .pro-icon {
            color: #059669;
            font-weight: bold;
            margin-right: 0.5rem;
        }
        .con-icon {
            color: #dc2626;
            font-weight: bold;
            margin-right: 0.5rem;
        }
        
        /* Related Comparisons */
        .related-comparisons {
            margin: 3rem 0;
        }
        .related-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
        }
        .related-item {
            background: white;
            padding: 1.5rem;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            transition: all 0.3s ease;
            text-decoration: none;
            color: inherit;
            display: block;
        }
        .related-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
            border-color: #3b82f6;
            text-decoration: none;
        }
        .related-item h3 {
            color: #1e40af;
            margin-bottom: 0.5rem;
            font-size: 1.1rem;
            line-height: 1.3;
        }
        .related-item p {
            color: #64748b;
            font-size: 0.9rem;
            line-height: 1.4;
        }
        .related-categories {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-top: 1rem;
        }
        .related-category {
            background: #dbeafe;
            color: #1e40af;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
        }
        
        /* Back Link */
        .back-link { 
            display: inline-block; 
            margin-top: 3rem; 
            color: #2563eb; 
            text-decoration: none;
            font-weight: 600;
            padding: 0.75rem 1.5rem;
            border: 2px solid #2563eb;
            border-radius: 6px;
            transition: all 0.3s ease;
        }
        .back-link:hover {
            background: #2563eb;
            color: white;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            body { padding: 10px; }
            .container { padding: 20px; }
            .header h1 { font-size: 2rem; }
            .comparison-table-container { padding: 1rem; }
            .comparison-table th, 
            .comparison-table td { padding: 0.75rem; }
            .quick-verdict { padding: 1.5rem; }
            .verdict-item { flex-direction: column; text-align: center; }
            .related-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header" role="banner">
            <h1>${escapeHtml(frontmatter.title || formatSlug(slug))}</h1>
            ${frontmatter.description ? `<p style="font-size: 1.2rem; color: #4a5568; margin-top: 1rem;">${escapeHtml(frontmatter.description)}</p>` : ''}
        </header>
        
        <main class="content" role="main">
            ${htmlContent}
        </main>
        
        <!-- Related Comparisons Section -->
        ${relatedComparisonsHTML}
        
        <nav aria-label="Breadcrumb navigation" style="text-align: center;">
            <a href="/" class="back-link">← Back to All Comparisons</a>
        </nav>
    </div>
    
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            // Lazy load images
            const lazyImages = [].slice.call(document.querySelectorAll('img[loading="lazy"]'));
            
            if ('IntersectionObserver' in window) {
                let lazyImageObserver = new IntersectionObserver(function(entries, observer) {
                    entries.forEach(function(entry) {
                        if (entry.isIntersecting) {
                            let lazyImage = entry.target;
                            lazyImage.src = lazyImage.dataset.src || lazyImage.src;
                            lazyImageObserver.unobserve(lazyImage);
                        }
                    });
                });

                lazyImages.forEach(function(lazyImage) {
                    lazyImageObserver.observe(lazyImage);
                });
            }
        });
    </script>
</body>
</html>`;
}

function generateRelatedComparisonsHTML(relatedComparisons, currentCategories) {
    if (relatedComparisons.length === 0) return '';
    
    const normalizedCats = normalizeCategories(currentCategories);
    const displayCategory = normalizedCats.length > 0 ? normalizedCats[0] : 'related';
    
    return `
<section class="related-comparisons" aria-labelledby="related-comparisons-title">
    <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); padding: 2.5rem; border-radius: 12px; margin: 3rem 0; border-left: 4px solid #0369a1;">
        <h2 id="related-comparisons-title" style="color: #0c4a6e; margin-bottom: 1.5rem; display: flex; align-items: center; gap: 0.5rem;">
            🔄 More ${displayCategory.charAt(0).toUpperCase() + displayCategory.slice(1)} Comparisons
        </h2>
        <p style="color: #475569; margin-bottom: 1.5rem;">You might also find these comparisons helpful:</p>
        
        <div class="related-grid">
            ${relatedComparisons.map(comparison => `
            <a href="/comparison/${comparison.slug}" class="related-item">
                <h3>${escapeHtml(comparison.title)}</h3>
                ${comparison.description ? `<p>${escapeHtml(comparison.description)}</p>` : ''}
                <div class="related-categories">
                    ${comparison.categories.map(cat => `
                        <span class="related-category">${cat}</span>
                    `).join('')}
                </div>
            </a>
            `).join('')}
        </div>
    </div>
</section>`;
}

// ==================== HELPER FUNCTIONS ====================

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatSlug(slug) {
    return slug.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function normalizeCategories(categories) {
    if (!categories) return [];
    
    let catsArray = Array.isArray(categories) ? categories : [categories];
    
    return catsArray
        .map(cat => cat.trim().toLowerCase())
        .filter(cat => cat !== 'comparisons' && cat !== 'comparison');
}

function findMatchingCategories(currentCats, otherCats) {
    return currentCats.filter(cat => 
        otherCats.includes(cat)
    );
}

function renderComparisonErrorPage(title, message) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <title>${title} - ReviewIndex</title>
    <meta name="robots" content="noindex">
    <style>
        body { font-family: system-ui, sans-serif; text-align: center; padding: 2rem; background: #f5f5f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .error-container { background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 8px 25px rgba(0,0,0,0.1); max-width: 500px; width: 100%; }
        h1 { color: #dc2626; margin-bottom: 1rem; font-size: 2rem; }
        p { color: #666; margin-bottom: 2rem; line-height: 1.6; }
        a { color: #2563eb; text-decoration: none; font-weight: 600; padding: 0.75rem 1.5rem; border: 2px solid #2563eb; border-radius: 6px; transition: all 0.3s ease; }
        a:hover { background: #2563eb; color: white; }
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
        headers: { 'Content-Type': 'text/html' }
    });
                }
