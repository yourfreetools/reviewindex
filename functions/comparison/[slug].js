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

        // Get related comparisons (matching at least 1 category, excluding current)
        const { frontmatter } = parseComparisonMarkdown(comparisonContent);
        const relatedComparisons = await fetchRelatedComparisons(slug, frontmatter.categories, env.GITHUB_TOKEN);

        // Convert markdown to HTML and render the comparison page
        const htmlContent = await renderComparisonPage(comparisonContent, slug, request.url, relatedComparisons, frontmatter);
        
        // Create response with 1-year cache headers
        return new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=31536000, immutable', // 1 year
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

async function fetchRelatedComparisons(currentSlug, currentCategories, githubToken) {
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
            
            // Filter files by category match and exclude current
            const categoryArray = Array.isArray(currentCategories) ? currentCategories : 
                                (currentCategories ? [currentCategories] : []);
            
            for (const file of files) {
                if (file.name.endsWith('.md') && file.name !== `${currentSlug}.md`) {
                    try {
                        const fileResponse = await fetch(file.download_url);
                        if (fileResponse.status === 200) {
                            const content = await fileResponse.text();
                            const { frontmatter } = parseComparisonMarkdown(content);
                            
                            // Check if at least one category matches (excluding "comparisons" category)
                            const fileCategories = Array.isArray(frontmatter.categories) ? frontmatter.categories : 
                                                 (frontmatter.categories ? [frontmatter.categories] : []);
                            const matchingCategories = fileCategories.filter(cat => 
                                categoryArray.includes(cat) && cat !== 'comparisons'
                            );
                            
                            if (matchingCategories.length > 0 || comparisons.length < 2) {
                                comparisons.push({
                                    slug: file.name.replace('.md', ''),
                                    title: frontmatter.title,
                                    description: frontmatter.description,
                                    products: frontmatter.comparison_products || [],
                                    categories: fileCategories
                                });
                                
                                // Stop when we have 2 matches
                                if (comparisons.length >= 2) break;
                            }
                        }
                    } catch (error) {
                        console.error(`Error processing related comparison ${file.name}:`, error);
                    }
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

async function renderComparisonPage(markdownContent, slug, requestUrl, relatedComparisons, frontmatter) {
    // Parse frontmatter and content
    const { frontmatter: parsedFrontmatter, content } = parseComparisonMarkdown(markdownContent);
    const allFrontmatter = { ...frontmatter, ...parsedFrontmatter };
    
    // Extract product data with affiliate links, images, videos, pros/cons
    const productData = extractProductData(content, allFrontmatter.comparison_products || []);
    
    // Convert markdown to HTML with proper formatting
    const htmlContent = convertComparisonMarkdownToHTML(content, allFrontmatter, productData);
    
    // Generate canonical URL
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    
    // Get products from frontmatter
    const products = allFrontmatter.comparison_products || [];
    
    // Extract winners from content
    const winners = extractWinnersFromContent(content);
    
    // Generate enhanced schema markup
    const schemaMarkup = generateEnhancedComparisonSchema(allFrontmatter, slug, canonicalUrl, products, productData);
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(allFrontmatter.title || formatComparisonSlug(slug))} - ReviewIndex</title>
    <meta name="description" content="${escapeHtml(allFrontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`)}">
    <link rel="canonical" href="${canonicalUrl}">
    
    <!-- SEO Meta Tags -->
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    <meta name="keywords" content="${products.join(', ')}, comparison, vs, review, specs, features, buy, price">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(allFrontmatter.title || formatComparisonSlug(slug))}">
    <meta property="og:description" content="${escapeHtml(allFrontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${escapeHtml(allFrontmatter.featured_image || productData[0]?.image || 'https://reviewindex.pages.dev/default-comparison-image.jpg')}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(allFrontmatter.title || formatComparisonSlug(slug))}">
    <meta name="twitter:description" content="${escapeHtml(allFrontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`)}">
    <meta name="twitter:image" content="${escapeHtml(allFrontmatter.featured_image || productData[0]?.image || 'https://reviewindex.pages.dev/default-comparison-image.jpg')}">
    
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
        
        /* Enhanced Comparison Table */
        .specs-table {
            width: 100%;
            border-collapse: collapse;
            margin: 2rem 0;
            font-size: 0.95rem;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: var(--shadow);
        }
        
        .specs-table th {
            background: var(--primary);
            color: white;
            padding: 1.25rem;
            text-align: center;
            font-weight: 600;
            font-size: 1.1rem;
            border: 1px solid var(--primary-dark);
        }
        
        .specs-table td {
            padding: 1rem;
            border: 1px solid var(--border);
            vertical-align: top;
        }
        
        .specs-table .feature-cell {
            background: var(--light);
            font-weight: 600;
            color: var(--dark);
            width: 200px;
            padding: 1rem 1.25rem;
        }
        
        .specs-table .product-cell {
            text-align: center;
            vertical-align: middle;
        }
        
        .price-badge {
            background: var(--success);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 25px;
            font-weight: 700;
            font-size: 1.1rem;
            display: inline-block;
            margin: 0.5rem 0;
        }
        
        .rating-stars {
            color: #f59e0b;
            font-size: 1.2rem;
            margin: 0.5rem 0;
        }
        
        /* Product Cards */
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
            transition: transform 0.3s ease;
        }
        
        .product-card:hover {
            transform: translateY(-5px);
        }
        
        .product-header {
            text-align: center;
            margin-bottom: 1.5rem;
            padding-bottom: 1.5rem;
            border-bottom: 2px solid var(--border);
        }
        
        .product-image {
            max-width: 200px;
            height: auto;
            border-radius: 12px;
            margin: 1rem auto;
            display: block;
            box-shadow: 0 8px 25px rgba(0,0,0,0.1);
        }
        
        .product-header h3 {
            font-size: 1.5rem;
            color: var(--dark);
            margin-bottom: 0.5rem;
        }
        
        /* Affiliate Buttons */
        .affiliate-btn {
            display: inline-block;
            background: var(--success);
            color: white;
            padding: 1rem 2rem;
            text-decoration: none;
            border-radius: 10px;
            font-weight: 700;
            font-size: 1.1rem;
            transition: all 0.3s ease;
            text-align: center;
            margin: 1rem 0;
            width: 100%;
            border: none;
            cursor: pointer;
        }
        
        .affiliate-btn:hover {
            background: #0d9c6d;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.4);
        }
        
        .affiliate-btn:active {
            transform: translateY(0);
        }
        
        /* Decision Questions Section */
        .decision-questions {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 3rem;
            border-radius: 20px;
            margin: 3rem 0;
        }
        
        .decision-questions h2 {
            text-align: center;
            margin-bottom: 2rem;
            font-size: 2rem;
        }
        
        .questions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin-top: 2rem;
        }
        
        .question-card {
            background: rgba(255,255,255,0.1);
            padding: 1.5rem;
            border-radius: 12px;
            backdrop-filter: blur(10px);
        }
        
        .question-card h4 {
            margin-bottom: 1rem;
            font-size: 1.2rem;
        }
        
        /* Pros/Cons Lists */
        .pros-cons {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin: 2rem 0;
        }
        
        @media (max-width: 768px) {
            .pros-cons {
                grid-template-columns: 1fr;
            }
        }
        
        .pros-list, .cons-list {
            padding: 1.5rem;
            border-radius: 12px;
        }
        
        .pros-list {
            background: #f0fdf4;
            border-left: 6px solid var(--success);
        }
        
        .cons-list {
            background: #fef2f2;
            border-left: 6px solid var(--danger);
        }
        
        .pros-list h4, .cons-list h4 {
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 1.3rem;
        }
        
        .pros-list ul, .cons-list ul {
            list-style: none;
            padding: 0;
        }
        
        .pros-list li, .cons-list li {
            padding: 0.75rem 0;
            border-bottom: 1px solid rgba(0,0,0,0.1);
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
        }
        
        .pros-list li:last-child, .cons-list li:last-child {
            border-bottom: none;
        }
        
        /* YouTube Embed */
        .video-embed {
            margin: 2rem 0;
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
            background: var(--primary);
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .related-vs {
            color: var(--dark);
            font-weight: 700;
            font-size: 0.8rem;
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
            
            .specs-table {
                font-size: 0.85rem;
                display: block;
                overflow-x: auto;
            }
            
            .specs-table th,
            .specs-table td {
                padding: 0.75rem 0.5rem;
            }
            
            .decision-questions {
                padding: 2rem 1rem;
            }
            
            .questions-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header class="header" role="banner">
            <h1>${escapeHtml(allFrontmatter.title || formatComparisonSlug(slug))}</h1>
            ${allFrontmatter.description ? `<p class="description">${escapeHtml(allFrontmatter.description)}</p>` : ''}
        </header>
        
        <main role="main">
            <!-- Quick Summary Cards with Dynamic Winners -->
            <div class="summary-cards">
                <div class="summary-card ${winners.overall === products[0] ? 'winner' : ''}">
                    <h3>🏆 Overall Winner</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--success); margin: 0.5rem 0;">${winners.overall || products[0] || 'Check Comparison'}</p>
                    <p style="color: #64748b;">${winners.overallDescription || 'Best all-around choice for most users'}</p>
                </div>
                
                <div class="summary-card ${winners.budget === products[1] ? 'winner' : ''}">
                    <h3>💰 Best Value</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--warning); margin: 0.5rem 0;">${winners.budget || products[1] || products[0] || 'Check Comparison'}</p>
                    <p style="color: #64748b;">${winners.budgetDescription || 'Great performance at competitive price'}</p>
                </div>
                
                <div class="summary-card ${winners.performance === products[0] ? 'winner' : ''}">
                    <h3>⚡ Performance</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--primary); margin: 0.5rem 0;">${winners.performance || products[0] || 'Check Comparison'}</p>
                    <p style="color: #64748b;">${winners.performanceDescription || 'Top-tier performance for power users'}</p>
                </div>
            </div>
            
            <!-- Enhanced Comparison Table -->
            <div class="content-section">
                <h2 class="section-title">📊 Key Specifications Comparison</h2>
                ${renderComparisonTable(productData, products)}
            </div>
            
            <!-- Individual Product Details -->
            <div class="content-section">
                <h2 class="section-title">🔍 Detailed Product Analysis</h2>
                <div class="products-grid">
                    ${productData.map(product => renderProductCard(product)).join('')}
                </div>
            </div>
            
            <!-- Decision Questions Section -->
            <div class="decision-questions">
                <h2>🤔 Questions to Ask Yourself</h2>
                <p style="text-align: center; margin-bottom: 2rem; font-size: 1.1rem; opacity: 0.9;">
                    Consider these factors when deciding which product is right for you
                </p>
                <div class="questions-grid">
                    <div class="question-card">
                        <h4>💰 Budget & Value</h4>
                        <p>Which product offers the best features for your budget? Are premium features worth the extra cost?</p>
                    </div>
                    <div class="question-card">
                        <h4>🎯 Primary Use Case</h4>
                        <p>What will you use this for most often? Gaming, productivity, photography, or everyday tasks?</p>
                    </div>
                    <div class="question-card">
                        <h4>⚡ Performance Needs</h4>
                        <p>Do you need top-tier performance or is moderate speed sufficient for your requirements?</p>
                    </div>
                    <div class="question-card">
                        <h4>🔋 Long-term Usage</h4>
                        <p>How long do you plan to keep this product? Consider future-proofing and durability.</p>
                    </div>
                </div>
            </div>
            
            <!-- Comparison Video Section -->
            ${extractComparisonVideo(content) ? `
            <div class="content-section">
                <h2 class="section-title">🎥 Side-by-Side Comparison Video</h2>
                <p style="color: #64748b; margin-bottom: 1.5rem;">Watch these products compared in real-world scenarios</p>
                ${extractComparisonVideo(content)}
            </div>
            ` : ''}
            
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
            <p>Last updated: ${allFrontmatter.date ? new Date(allFrontmatter.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Recently'}</p>
        </footer>
    </div>
    
    <script>
        // Enhanced interactivity
        document.addEventListener('DOMContentLoaded', function() {
            // Handle affiliate button clicks
            const affiliateButtons = document.querySelectorAll('.affiliate-btn');
            affiliateButtons.forEach(btn => {
                btn.addEventListener('click', function(e) {
                    // Track affiliate clicks (you can integrate with analytics here)
                    console.log('Affiliate link clicked:', this.href);
                    // The link will open in new tab as per target="_blank"
                });
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
            
            // Lazy loading for images
            const images = document.querySelectorAll('img[data-src]');
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        imageObserver.unobserve(img);
                    }
                });
            });
            
            images.forEach(img => imageObserver.observe(img));
        });
    </script>
</body>
</html>`;
}

function extractProductData(content, products) {
    const productData = [];
    const lines = content.split('\n');
    let currentProduct = null;
    let inProductSection = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Detect product sections
        if (line.startsWith('### ') && products) {
            const productName = line.replace('### ', '').trim();
            if (products.includes(productName)) {
                currentProduct = {
                    name: productName,
                    price: '',
                    releaseDate: '',
                    bestFor: '',
                    rating: '',
                    affiliateLink: '',
                    image: '',
                    video: '',
                    pros: [],
                    cons: [],
                    specs: {}
                };
                inProductSection = true;
                continue;
            }
        }
        
        if (inProductSection && currentProduct) {
            // Extract price
            if (line.startsWith('**Price:**')) {
                currentProduct.price = line.replace('**Price:**', '').trim();
            }
            // Extract release date
            else if (line.startsWith('**Release Date:**')) {
                currentProduct.releaseDate = line.replace('**Release Date:**', '').trim();
            }
            // Extract best for
            else if (line.startsWith('**Best For:**')) {
                currentProduct.bestFor = line.replace('**Best For:**', '').trim();
            }
            // Extract rating
            else if (line.startsWith('**Overall Rating:**')) {
                currentProduct.rating = line.replace('**Overall Rating:**', '').trim();
            }
            // Extract affiliate link
            else if (line.includes('[**Check Current Price & Offers**]')) {
                const match = line.match(/\[.*\]\((.*)\)/);
                if (match) {
                    currentProduct.affiliateLink = match[1];
                }
            }
            // Extract image
            else if (line.startsWith('![')) {
                const match = line.match(/!\[.*\]\((.*)\)/);
                if (match) {
                    currentProduct.image = match[1];
                }
            }
            // Extract video
            else if (line.includes('youtube.com') || line.includes('youtu.be')) {
                const match = line.match(/src="([^"]*)"/);
                if (match) {
                    currentProduct.video = match[1];
                }
            }
            // Extract pros
            else if (line.startsWith('✅')) {
                currentProduct.pros.push(line.replace('✅', '').trim());
            }
            // Extract cons
            else if (line.startsWith('❌')) {
                currentProduct.cons.push(line.replace('❌', '').trim());
            }
            // Extract specifications
            else if (line.includes(':')) {
                const [key, value] = line.split(':').map(part => part.trim());
                if (key && value && !key.startsWith('**') && !value.startsWith('[')) {
                    currentProduct.specs[key] = value;
                }
            }
            
            // End of product section
            if (line === '---' && inProductSection) {
                productData.push(currentProduct);
                inProductSection = false;
                currentProduct = null;
            }
        }
    }
    
    return productData;
}

function renderComparisonTable(productData, products) {
    if (productData.length === 0) return '';
    
    const commonSpecs = Object.keys(productData[0].specs || {});
    
    return `
    <table class="specs-table">
        <thead>
            <tr>
                <th>Feature</th>
                ${products.map(product => `<th>${escapeHtml(product)}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            <!-- Price Row -->
            <tr>
                <td class="feature-cell">💰 Price</td>
                ${productData.map(product => `
                    <td class="product-cell">
                        ${product.price ? `<div class="price-badge">${escapeHtml(product.price)}</div>` : 'N/A'}
                        ${product.affiliateLink ? `
                            <a href="${escapeHtml(product.affiliateLink)}" class="affiliate-btn" target="_blank" rel="nofollow sponsored">
                                Check Price & Offers
                            </a>
                        ` : ''}
                    </td>
                `).join('')}
            </tr>
            
            <!-- Release Date Row -->
            <tr>
                <td class="feature-cell">📅 Release Date</td>
                ${productData.map(product => `
                    <td class="product-cell">${product.releaseDate ? escapeHtml(product.releaseDate) : 'N/A'}</td>
                `).join('')}
            </tr>
            
            <!-- Best For Row -->
            <tr>
                <td class="feature-cell">🎯 Best For</td>
                ${productData.map(product => `
                    <td class="product-cell">${product.bestFor ? escapeHtml(product.bestFor) : 'N/A'}</td>
                `).join('')}
            </tr>
            
            <!-- Rating Row -->
            <tr>
                <td class="feature-cell">⭐ Rating</td>
                ${productData.map(product => `
                    <td class="product-cell">
                        ${product.rating ? `
                            <div class="rating-stars">${escapeHtml(product.rating)}</div>
                        ` : 'N/A'}
                    </td>
                `).join('')}
            </tr>
            
            <!-- Specifications -->
            ${commonSpecs.map(spec => `
                <tr>
                    <td class="feature-cell">${escapeHtml(spec)}</td>
                    ${productData.map(product => `
                        <td class="product-cell">${escapeHtml(product.specs[spec] || 'N/A')}</td>
                    `).join('')}
                </tr>
            `).join('')}
        </tbody>
    </table>`;
}

function renderProductCard(product) {
    return `
    <div class="product-card" id="product-${product.name.toLowerCase().replace(/\s+/g, '-')}">
        <div class="product-header">
            ${product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" class="product-image" loading="lazy">` : ''}
            <h3>${escapeHtml(product.name)}</h3>
            ${product.price ? `<div class="price-badge">${escapeHtml(product.price)}</div>` : ''}
            ${product.rating ? `<div class="rating-stars">${escapeHtml(product.rating)}</div>` : ''}
        </div>
        
        ${product.affiliateLink ? `
            <a href="${escapeHtml(product.affiliateLink)}" class="affiliate-btn" target="_blank" rel="nofollow sponsored">
                ✅ Check Current Price & Offers
            </a>
        ` : ''}
        
        ${product.bestFor ? `
            <p><strong>Best For:</strong> ${escapeHtml(product.bestFor)}</p>
        ` : ''}
        
        <!-- Pros and Cons -->
        <div class="pros-cons">
            ${product.pros.length > 0 ? `
            <div class="pros-list">
                <h4>✅ Pros</h4>
                <ul>
                    ${product.pros.map(pro => `<li>${escapeHtml(pro)}</li>`).join('')}
                </ul>
            </div>
            ` : ''}
            
            ${product.cons.length > 0 ? `
            <div class="cons-list">
                <h4>❌ Cons</h4>
                <ul>
                    ${product.cons.map(con => `<li>${escapeHtml(con)}</li>`).join('')}
                </ul>
            </div>
            ` : ''}
        </div>
        
        <!-- Video Review -->
        ${product.video ? `
            <div class="video-embed">
                <h4>🎥 Video Review</h4>
                <div class="video-wrapper">
                    <iframe src="${escapeHtml(product.video)}" 
                            title="${escapeHtml(product.name)} Review Video" 
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                            allowfullscreen>
                    </iframe>
                </div>
            </div>
        ` : ''}
    </div>`;
}

function extractComparisonVideo(content) {
    const videoMatch = content.match(/<iframe[^>]*src="([^"]*)"[^>]*><\/iframe>/);
    if (videoMatch) {
        return `
        <div class="video-wrapper">
            <iframe src="${escapeHtml(videoMatch[1])}" 
                    title="Product Comparison Video" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                    allowfullscreen>
            </iframe>
        </div>`;
    }
    return '';
}

// ... (keep the existing parseComparisonMarkdown, convertComparisonMarkdownToHTML, 
// extractWinnersFromContent, cleanCellContent, formatComparisonSlug, escapeHtml, 
// and renderErrorPage functions exactly as they were in your original code)

function generateEnhancedComparisonSchema(frontmatter, slug, canonicalUrl, products, productData) {
    const schema = {
        "@context": "https://schema.org",
        "@type": "ProductGroup",
        "name": frontmatter.title || formatComparisonSlug(slug),
        "description": frontmatter.description || `Comparison of ${products.join(' vs ')}`,
        "url": canonicalUrl,
        "product": productData.map((product, index) => ({
            "@type": "Product",
            "name": product.name,
            "description": `Detailed review and specifications for ${product.name}`,
            "brand": {
                "@type": "Brand",
                "name": product.name.split(' ')[0] // Extract brand from product name
            },
            "offers": {
                "@type": "Offer",
                "price": extractPriceValue(product.price),
                "priceCurrency": "USD",
                "availability": "https://schema.org/InStock",
                "url": product.affiliateLink || canonicalUrl
            },
            "review": {
                "@type": "Review",
                "reviewRating": {
                    "@type": "Rating",
                    "ratingValue": extractRatingValue(product.rating),
                    "bestRating": "5"
                }
            }
        })),
        "mainEntityOfPage": {
            "@type": "WebPage",
            "@id": canonicalUrl
        }
    };
    
    return JSON.stringify(schema, null, 2);
}

function extractPriceValue(priceText) {
    if (!priceText) return '0';
    const match = priceText.match(/\$([0-9,]+)/);
    return match ? match[1].replace(',', '') : '0';
}

function extractRatingValue(ratingText) {
    if (!ratingText) return '0';
    const match = ratingText.match(/([0-9.]+)/);
    return match ? match[1] : '0';
                    }
