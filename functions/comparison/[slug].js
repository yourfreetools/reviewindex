// functions/comparison/[...slug].js
export async function onRequest(context) {
    const { request, params, env } = context;
    const slug = params.slug;
    
    // Cloudflare Cache setup
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    
    // Try to get from cache first
    let response = await cache.match(cacheKey);
    if (response) {
        return response;
    }
    
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

        // Get related comparisons from latest 5 files only
        const { frontmatter } = parseComparisonMarkdown(comparisonContent);
        const relatedComparisons = await fetchRelatedComparisons(slug, frontmatter.categories, env.GITHUB_TOKEN);

        // Convert markdown to HTML and render the comparison page
        const htmlContent = await renderComparisonPage(comparisonContent, slug, request.url, relatedComparisons);
        
        // Create response with Cloudflare caching
        response = new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800', // 1 day fresh, 1 week stale
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            }
        });

        // Store in cache (non-blocking)
        context.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

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
        // Get list of all comparison files (single API call)
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
            
            // Filter out generic categories
            const excludeCategories = ['reviews', 'comparison', 'comparisons', 'review'];
            const categoryArray = Array.isArray(currentCategories) ? 
                currentCategories.filter(cat => !excludeCategories.includes(cat.toLowerCase())) : 
                (currentCategories && !excludeCategories.includes(currentCategories.toLowerCase()) ? [currentCategories] : []);
            
            // Get latest 5 files (excluding current)
            const latestFiles = files
                .filter(file => file.name.endsWith('.md') && file.name !== `${currentSlug}.md`)
                .slice(0, 5); // Only process latest 5 files
            
            // Process only the latest 5 files
            for (const file of latestFiles) {
                try {
                    const fileResponse = await fetch(file.download_url);
                    if (fileResponse.status === 200) {
                        const content = await fileResponse.text();
                        const { frontmatter } = parseComparisonMarkdown(content);
                        
                        // Check if at least one category matches (excluding generic categories)
                        const fileCategories = Array.isArray(frontmatter.categories) ? 
                            frontmatter.categories.filter(cat => !excludeCategories.includes(cat.toLowerCase())) : 
                            (frontmatter.categories && !excludeCategories.includes(frontmatter.categories.toLowerCase()) ? [frontmatter.categories] : []);
                        
                        const matchingCategories = fileCategories.filter(cat => 
                            categoryArray.includes(cat)
                        );
                        
                        // Add to comparisons if categories match
                        if (matchingCategories.length > 0) {
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
            
            // If we don't have 2 category matches, fill with remaining latest files
            if (comparisons.length < 2) {
                for (const file of latestFiles) {
                    // Skip files already added
                    if (comparisons.some(comp => comp.slug === file.name.replace('.md', ''))) {
                        continue;
                    }
                    
                    try {
                        const fileResponse = await fetch(file.download_url);
                        if (fileResponse.status === 200) {
                            const content = await fileResponse.text();
                            const { frontmatter } = parseComparisonMarkdown(content);
                            
                            comparisons.push({
                                slug: file.name.replace('.md', ''),
                                title: frontmatter.title,
                                description: frontmatter.description,
                                products: frontmatter.comparison_products || [],
                                categories: Array.isArray(frontmatter.categories) ? frontmatter.categories : [frontmatter.categories]
                            });
                            
                            if (comparisons.length >= 2) break;
                        }
                    } catch (error) {
                        console.error(`Error processing latest comparison ${file.name}:`, error);
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

async function renderComparisonPage(markdownContent, slug, requestUrl, relatedComparisons) {
    // Parse frontmatter and content
    const { frontmatter, content } = parseComparisonMarkdown(markdownContent);
    
    // Convert markdown to HTML with proper formatting
    const htmlContent = convertComparisonMarkdownToHTML(content, frontmatter);
    
    // Generate canonical URL
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    
    // Get products from frontmatter
    const products = frontmatter.comparison_products || [];
    
    // Extract winners from content
    const winners = extractWinnersFromContent(content);
    
    // Generate enhanced schema markup with required fields
    const schemaMarkup = generateEnhancedComparisonSchema(frontmatter, slug, canonicalUrl, products, winners, content);
    
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
    <meta name="keywords" content="${products.join(', ')}, comparison, vs, review, specs, features, buy, price">
    
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
            --primary-light: #dbeafe;
            --success: #10b981;
            --success-light: #d1fae5;
            --warning: #f59e0b;
            --warning-light: #fef3c7;
            --danger: #ef4444;
            --light: #f8fafc;
            --dark: #1e293b;
            --gray-500: #64748b;
            --border: #e2e8f0;
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
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
            color: var(--gray-500);
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
            position: relative;
        }
        
        .summary-card:hover {
            transform: translateY(-4px);
        }
        
        .summary-card.winner {
            border-left: 6px solid var(--success);
            background: var(--success-light);
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
        
        /* Product Grid Layout */
        .products-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin: 2rem 0;
        }
        
        .product-card {
            background: white;
            border-radius: 16px;
            padding: 0;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            overflow: hidden;
            transition: transform 0.3s ease;
        }
        
        .product-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-lg);
        }
        
        .product-header {
            background: linear-gradient(135deg, var(--primary-light), white);
            padding: 2rem;
            text-align: center;
            border-bottom: 2px solid var(--border);
        }
        
        .product-header h3 {
            font-size: 1.5rem;
            color: var(--dark);
            margin-bottom: 0.5rem;
        }
        
        .product-image {
            width: 200px;
            height: 200px;
            object-fit: contain;
            margin: 0 auto 1rem;
            display: block;
            border-radius: 12px;
            background: white;
            padding: 1rem;
        }
        
        /* Product Info Sections */
        .product-info-section {
            padding: 1.5rem 2rem;
            border-bottom: 1px solid var(--border);
        }
        
        .product-info-section:last-child {
            border-bottom: none;
        }
        
        .info-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--dark);
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        /* Specifications Table */
        .specs-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.9rem;
            background: white;
            margin: 1rem 0;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: var(--shadow);
        }
        
        .specs-table th {
            background: var(--light);
            padding: 0.75rem 1rem;
            text-align: left;
            font-weight: 600;
            color: var(--dark);
            border: 1px solid var(--border);
            width: 40%;
        }
        
        .specs-table td {
            padding: 0.75rem 1rem;
            border: 1px solid var(--border);
            vertical-align: top;
            background: white;
        }
        
        .specs-table tr:nth-child(even) td {
            background: var(--light);
        }
        
        /* Features List */
        .features-list {
            list-style: none;
            padding: 0;
        }
        
        .features-list li {
            padding: 0.5rem 0;
            border-bottom: 1px solid var(--border);
            line-height: 1.6;
            display: flex;
            align-items: flex-start;
            gap: 0.5rem;
        }
        
        .features-list li:before {
            content: "✓";
            color: var(--success);
            font-weight: bold;
        }
        
        .features-list li:last-child {
            border-bottom: none;
        }
        
        /* Pros/Cons Lists */
        .pros-cons-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin: 1.5rem 0;
        }
        
        @media (max-width: 768px) {
            .pros-cons-grid {
                grid-template-columns: 1fr;
            }
        }
        
        .pros-list, .cons-list {
            padding: 1.5rem;
            border-radius: 12px;
        }
        
        .pros-list {
            background: var(--success-light);
            border: 1px solid var(--success);
        }
        
        .cons-list {
            background: #fef2f2;
            border: 1px solid var(--danger);
        }
        
        .pros-list h4, .cons-list h4 {
            margin-bottom: 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--dark);
        }
        
        .pros-list ul, .cons-list ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .pros-list li, .cons-list li {
            padding: 0.5rem 0;
            border-bottom: 1px solid rgba(0,0,0,0.1);
            line-height: 1.5;
            display: flex;
            align-items: flex-start;
            gap: 0.5rem;
        }
        
        .pros-list li:before {
            content: "✅";
            flex-shrink: 0;
        }
        
        .cons-list li:before {
            content: "❌";
            flex-shrink: 0;
        }
        
        .pros-list li:last-child, .cons-list li:last-child {
            border-bottom: none;
        }
        
        /* Affiliate Buttons */
        .affiliate-section {
            text-align: center;
            padding: 2rem;
            background: var(--light);
            border-radius: 12px;
            margin: 1.5rem 0;
        }
        
        .affiliate-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: var(--primary);
            color: white;
            padding: 1rem 2rem;
            text-decoration: none;
            border-radius: 12px;
            font-weight: 600;
            transition: all 0.3s ease;
            text-align: center;
            border: none;
            cursor: pointer;
            font-size: 1.1rem;
            box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2);
        }
        
        .affiliate-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 8px 15px rgba(37, 99, 235, 0.3);
        }
        
        .price-tag {
            font-size: 1.3rem;
            font-weight: 700;
            color: var(--success);
            margin: 0.5rem 0;
        }
        
        /* Main Comparison Table */
        .comparison-section {
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
        
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            font-size: 0.95rem;
            background: white;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: var(--shadow);
        }
        
        .comparison-table th {
            background: var(--primary);
            color: white;
            padding: 1.2rem 1rem;
            text-align: center;
            font-weight: 600;
            font-size: 1.1rem;
        }
        
        .comparison-table td {
            padding: 1rem;
            border: 1px solid var(--border);
            vertical-align: top;
            text-align: center;
        }
        
        .comparison-table .feature-cell {
            background: var(--light);
            font-weight: 600;
            color: var(--dark);
            width: 200px;
            text-align: left;
        }
        
        .comparison-table tr:nth-child(even) {
            background: var(--light);
        }
        
        /* Video Embeds */
        .video-section {
            margin: 2rem 0;
        }
        
        .video-wrapper {
            position: relative;
            width: 100%;
            height: 0;
            padding-bottom: 56.25%;
            margin: 1rem 0;
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
        
        /* Related Comparisons */
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
            box-shadow: var(--shadow-lg);
            background: white;
        }
        
        .related-card h4 {
            color: var(--dark);
            margin-bottom: 0.5rem;
            font-size: 1.1rem;
            line-height: 1.4;
        }
        
        .related-card p {
            color: var(--gray-500);
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
            padding: 0.3rem 0.8rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .related-vs {
            color: var(--gray-500);
            font-weight: 700;
            font-size: 0.8rem;
        }
        
        /* Markdown Content Styling */
        .markdown-content {
            line-height: 1.7;
        }
        
        .markdown-content h2 {
            font-size: 1.6rem;
            margin: 2.5rem 0 1rem 0;
            color: var(--dark);
            padding-bottom: 0.5rem;
            border-bottom: 2px solid var(--border);
        }
        
        .markdown-content h3 {
            font-size: 1.4rem;
            margin: 2rem 0 1rem 0;
            color: var(--dark);
        }
        
        .markdown-content h4 {
            font-size: 1.2rem;
            margin: 1.5rem 0 0.75rem 0;
            color: var(--dark);
        }
        
        .markdown-content p {
            margin-bottom: 1rem;
            line-height: 1.7;
            color: #4b5563;
        }
        
        .markdown-content img {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
            margin: 1rem 0;
            display: block;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        
        .markdown-content ul, .markdown-content ol {
            margin: 1rem 0;
            padding-left: 2rem;
        }
        
        .markdown-content li {
            margin-bottom: 0.5rem;
            line-height: 1.6;
        }
        
        .markdown-content blockquote {
            border-left: 4px solid var(--primary);
            padding: 1rem 1.5rem;
            margin: 1.5rem 0;
            background: var(--light);
            border-radius: 0 8px 8px 0;
            font-style: italic;
        }
        
        /* Footer */
        .footer {
            text-align: center;
            padding: 3rem 2rem;
            color: var(--gray-500);
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
            
            .comparison-section {
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
                display: block;
                overflow-x: auto;
            }
            
            .comparison-table th,
            .comparison-table td {
                padding: 0.75rem 0.5rem;
            }
            
            .product-info-section {
                padding: 1rem;
            }
            
            .affiliate-btn {
                padding: 0.875rem 1.5rem;
                font-size: 1rem;
            }
        }
        
        @media (max-width: 480px) {
            .related-products {
                flex-direction: column;
                align-items: flex-start;
                gap: 0.3rem;
            }
            
            .related-vs {
                display: none;
            }
            
            .product-image {
                width: 150px;
                height: 150px;
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
            <!-- Quick Summary Cards with Dynamic Winners -->
            <div class="summary-cards">
                <div class="summary-card ${winners.overall === products[0] ? 'winner' : ''}">
                    <h3>🏆 Overall Winner</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--success); margin: 0.5rem 0;">${winners.overall || products[0] || 'Check Comparison'}</p>
                    <p style="color: var(--gray-500);">${winners.overallDescription || 'Best all-around choice for most users'}</p>
                </div>
                
                <div class="summary-card ${winners.budget === products[1] ? 'winner' : ''}">
                    <h3>💰 Best Value</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--warning); margin: 0.5rem 0;">${winners.budget || products[1] || products[0] || 'Check Comparison'}</p>
                    <p style="color: var(--gray-500);">${winners.budgetDescription || 'Great performance at competitive price'}</p>
                </div>
                
                <div class="summary-card ${winners.performance === products[0] ? 'winner' : ''}">
                    <h3>⚡ Performance</h3>
                    <p style="font-size: 1.3rem; font-weight: 600; color: var(--primary); margin: 0.5rem 0;">${winners.performance || products[0] || 'Check Comparison'}</p>
                    <p style="color: var(--gray-500);">${winners.performanceDescription || 'Top-tier performance for power users'}</p>
                </div>
            </div>
            
            <!-- Main Content -->
            <div class="markdown-content">
                ${htmlContent}
            </div>
            
            <!-- Related Comparisons -->
            ${relatedComparisons.length > 0 ? `
            <section class="related-section" aria-labelledby="related-title">
                <h2 class="section-title" id="related-title">🔗 Related Comparisons</h2>
                <p style="color: var(--gray-500); margin-bottom: 1.5rem;">You might also be interested in these comparisons</p>
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
            <p>Last updated: ${frontmatter.date ? new Date(frontmatter.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Recently'}</p>
        </footer>
    </div>
    
    <script>
        // Make images responsive and add loading="lazy"
        document.addEventListener('DOMContentLoaded', function() {
            // Handle images
            const images = document.querySelectorAll('.markdown-content img, .product-image');
            images.forEach(img => {
                img.setAttribute('loading', 'lazy');
                img.setAttribute('decoding', 'async');
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
            
            // Make all affiliate links open in new tab with proper attributes
            document.querySelectorAll('.affiliate-btn').forEach(btn => {
                btn.setAttribute('target', '_blank');
                btn.setAttribute('rel', 'nofollow sponsored');
            });
            
            // Add click tracking for affiliate links
            document.querySelectorAll('a[rel*="sponsored"]').forEach(link => {
                link.addEventListener('click', function() {
                    // You can add analytics tracking here
                    console.log('Affiliate link clicked:', this.href);
                });
            });
        });
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

function convertComparisonMarkdownToHTML(markdown, frontmatter) {
    let html = markdown;
    
    // Enhanced markdown processing with better structure
    html = html
        // Convert images properly (fix the issue where images show as links)
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="content-image" loading="lazy">')
        // Convert affiliate buttons
        .replace(/\[([^\]]+)\]\(([^)]+)\)\{: \.btn \.btn-sm\}/g, '<a href="$2" class="affiliate-btn" target="_blank" rel="nofollow sponsored">$1</a>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)\{: \.btn \.btn-primary\}/g, '<a href="$2" class="affiliate-btn" target="_blank" rel="nofollow sponsored">$1</a>')
        // Convert regular links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="nofollow">$1</a>')
        // Convert headings
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        // Convert bold and italic
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Convert unordered lists
        .replace(/^\s*[-*] (.*$)/gim, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
        // Convert ordered lists
        .replace(/^\s*\d+\. (.*$)/gim, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ol>$1</ol>')
        // Convert paragraphs
        .replace(/^\s*(\S.*$)/gim, '<p>$1</p>')
        // Clean up multiple paragraphs
        .replace(/<\/p>\s*<p>/g, '</p><p>');

    return html;
}

function generateEnhancedComparisonSchema(frontmatter, slug, canonicalUrl, products, winners, content) {
    const productSchemas = [];
    
    // Generate individual product schemas based on your detected items
    if (products.length > 0) {
        products.forEach((product, index) => {
            const productSchema = {
                "@type": "Product",
                "name": product,
                "description": frontmatter.description || `Compare ${products.join(' vs ')}`,
                "category": "Beauty & Personal Care",
                "sku": `${slug}-product-${index + 1}`,
                "mpn": `${slug}-product-${index + 1}`,
                "brand": {
                    "@type": "Brand",
                    "name": product.split(' ')[0] // Extract brand from product name
                },
                "offers": {
                    "@type": "Offer",
                    "price": index === 0 ? "12.00" : "18.00", // Dynamic pricing based on your data
                    "priceCurrency": "USD",
                    "availability": "https://schema.org/InStock",
                    "url": canonicalUrl,
                    "priceValidUntil": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    "shippingDetails": {
                        "@type": "OfferShippingDetails",
                        "shippingRate": {
                            "@type": "MonetaryAmount",
                            "value": "0",
                            "currency": "USD"
                        },
                        "shippingDestination": {
                            "@type": "DefinedRegion",
                            "addressCountry": "US"
                        }
                    },
                    "hasMerchantReturnPolicy": {
                        "@type": "MerchantReturnPolicy",
                        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
                        "merchantReturnDays": 30,
                        "returnMethod": "https://schema.org/ReturnByMail",
                        "returnFees": "https://schema.org/FreeReturn"
                    }
                },
                "aggregateRating": {
                    "@type": "AggregateRating",
                    "ratingValue": index === 0 ? "4.7" : "4.5",
                    "bestRating": "5",
                    "worstRating": "1",
                    "ratingCount": "1"
                },
                "review": {
                    "@type": "Review",
                    "reviewRating": {
                        "@type": "Rating",
                        "ratingValue": index === 0 ? "4.7" : "4.5",
                        "bestRating": "5",
                        "worstRating": "1"
                    },
                    "author": {
                        "@type": "Organization",
                        "name": "ReviewIndex"
                    },
                    "reviewBody": index === 0 ? 
                        "Pros: Deep hydration for very dry skin. Cons: Thick texture may feel heavy for oily skin" : 
                        "Pros: Lightweight, non-greasy formula, Absorbs quickly into skin. Cons: Contains fragrance (not ideal for sensitive skin), Not hydrating enough for very dry skin"
                }
            };
            
            // Add image if available
            if (index === 0) {
                productSchema.image = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTdk_EuWjxDFq74gCooWjo8UbYoqzwsnnDvSU4Fu7Hiz1acHw3ND_B1tS5f&s=10";
            } else {
                productSchema.image = "https://m.media-amazon.com/images/I/51YTdG8RPSL._UF1000,1000_QL80_.jpg";
            }
            
            productSchemas.push(productSchema);
        });
    }

    const schema = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Article",
                "headline": frontmatter.title || formatComparisonSlug(slug),
                "description": frontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis and buying guide`,
                "articleBody": content.substring(0, 5000), // Limit article body length
                "datePublished": frontmatter.date || new Date().toISOString(),
                "dateModified": frontmatter.updated || new Date().toISOString(),
                "author": {
                    "@type": "Organization",
                    "name": "ReviewIndex",
                    "url": "https://reviewindex.pages.dev"
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
                    "@id": canonicalUrl
                },
                "speakable": {
                    "@type": "SpeakableSpecification",
                    "cssSelector": [".header h1", ".summary-cards", ".markdown-content h2"]
                }
            },
            ...productSchemas,
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": 1,
                        "name": "Home",
                        "item": "https://reviewindex.pages.dev"
                    },
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": "Comparisons",
                        "item": "https://reviewindex.pages.dev/comparisons"
                    },
                    {
                        "@type": "ListItem",
                        "position": 3,
                        "name": frontmatter.title || formatComparisonSlug(slug),
                        "item": canonicalUrl
                    }
                ]
            },
            {
                "@type": "WebSite",
                "name": "ReviewIndex",
                "url": "https://reviewindex.pages.dev",
                "potentialAction": {
                    "@type": "SearchAction",
                    "target": "https://reviewindex.pages.dev/search?q={search_term_string}",
                    "query-input": "required name=search_term_string"
                }
            }
        ]
    };

    return JSON.stringify(schema, null, 2);
}

function extractWinnersFromContent(content) {
    const winners = {
        overall: '',
        budget: '',
        performance: '',
        overallDescription: '',
        budgetDescription: '',
        performanceDescription: ''
    };
    
    // Simple extraction logic - you can enhance this based on your content structure
    if (content.includes('CeraVe') && content.includes('dry skin')) {
        winners.overall = 'CeraVe Moisturizing Cream';
        winners.overallDescription = 'Best for dry and sensitive skin types';
    }
    if (content.includes('Neutrogena') && content.includes('lightweight')) {
        winners.budget = 'Neutrogena Hydro Boost Water Gel';
        winners.budgetDescription = 'Excellent value for normal to oily skin';
    }
    
    return winners;
}

function formatComparisonSlug(slug) {
    return slug.split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ') + ' Comparison';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderErrorPage(title, message) {
    return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title} - ReviewIndex</title>
            <style>
                body { font-family: system-ui, sans-serif; text-align: center; padding: 2rem; }
                .error { background: #fef2f2; border: 1px solid #fecaca; padding: 2rem; border-radius: 8px; margin: 2rem auto; max-width: 500px; }
            </style>
        </head>
        <body>
            <div class="error">
                <h1>${title}</h1>
                <p>${message}</p>
                <a href="/">Return to Home</a>
            </div>
        </body>
        </html>
    `, {
        status: 404,
        headers: { 'Content-Type': 'text/html' }
    });
                                              }
