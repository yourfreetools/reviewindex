// functions/comparison/[...slug].js
export async function onRequest(context) {
    const { request, params, env } = context;
    const slug = params.slug;
    
    try {
        // Handle .md file requests - redirect to clean URL
        if (slug.endsWith('.md')) {
            const cleanSlug = slug.replace('.md', '');
            return Response.redirect(`${new URL(request.url).origin}/comparison/${cleanSlug}`, 301);
        }

        // Fetch comparison content
        const comparisonContent = await fetchComparisonContent(slug, env.GITHUB_TOKEN);
        
        if (!comparisonContent) {
            return renderErrorPage('Comparison Not Found', 'The requested product comparison could not be found.');
        }

        // Parse frontmatter and get categories
        const { frontmatter } = parseComparisonMarkdown(comparisonContent);
        
        // Get related comparisons (matching at least 1 category, excluding current and generic categories)
        const relatedComparisons = await fetchRelatedComparisons(
            slug, 
            frontmatter.categories, 
            env.GITHUB_TOKEN
        );

        // Convert to HTML and render page
        const htmlContent = await renderComparisonPage(
            comparisonContent, 
            slug, 
            request.url, 
            relatedComparisons,
            frontmatter
        );
        
        // Return with 6-month cache and security headers
        return new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=15552000, immutable',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                'X-XSS-Protection': '1; mode=block'
            }
        });

    } catch (error) {
        console.error('Error rendering comparison:', error);
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
                    'User-Agent': 'ReviewIndex-App',
                    'Accept': 'application/vnd.github.v3.raw'
                }
            }
        );

        return response.status === 200 ? await response.text() : null;
    } catch (error) {
        console.error('Error fetching comparison:', error);
        return null;
    }
}

async function fetchRelatedComparisons(currentSlug, currentCategories, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/comparisons`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'ReviewIndex-App'
                }
            }
        );

        if (response.status !== 200) return [];

        const files = await response.json();
        const comparisons = [];
        
        // Normalize categories and exclude generic ones
        const categoryArray = Array.isArray(currentCategories) ? currentCategories : 
                            (currentCategories ? [currentCategories] : []);
        
        const excludedCategories = ['review', 'reviews', 'comparison', 'comparisons'];
        const filteredCategories = categoryArray.filter(cat => 
            !excludedCategories.includes(cat.toLowerCase())
        );

        for (const file of files) {
            if (file.name.endsWith('.md') && file.name !== `${currentSlug}.md`) {
                try {
                    const fileResponse = await fetch(file.download_url);
                    if (fileResponse.status === 200) {
                        const content = await fileResponse.text();
                        const { frontmatter } = parseComparisonMarkdown(content);
                        
                        const fileCategories = Array.isArray(frontmatter.categories) ? frontmatter.categories : 
                                             (frontmatter.categories ? [frontmatter.categories] : []);
                        
                        // Check for category matches (excluding generic categories)
                        const matchingCategories = fileCategories.filter(fileCat => 
                            filteredCategories.some(currentCat => 
                                fileCat.toLowerCase() === currentCat.toLowerCase()
                            )
                        );

                        if (matchingCategories.length > 0) {
                            comparisons.push({
                                slug: file.name.replace('.md', ''),
                                title: frontmatter.title,
                                description: frontmatter.description,
                                products: frontmatter.comparison_products || [],
                                categories: fileCategories,
                                matchCount: matchingCategories.length,
                                image: frontmatter.featured_image,
                                date: frontmatter.date
                            });
                            
                            if (comparisons.length >= 4) break;
                        }
                    }
                } catch (error) {
                    console.error(`Error processing related comparison ${file.name}:`, error);
                }
            }
        }
        
        // Sort by number of matching categories and date (newest first)
        return comparisons.sort((a, b) => {
            if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
            return new Date(b.date || 0) - new Date(a.date || 0);
        }).slice(0, 3);
        
    } catch (error) {
        console.error('Error fetching related comparisons:', error);
        return [];
    }
}

async function renderComparisonPage(markdownContent, slug, requestUrl, relatedComparisons, frontmatter) {
    const { content } = parseComparisonMarkdown(markdownContent);
    const htmlContent = convertComparisonMarkdownToHTML(content, frontmatter);
    const canonicalUrl = `https://reviewindex.pages.dev/comparison/${slug}`;
    const products = frontmatter.comparison_products || [];
    const winners = extractWinnersFromContent(content);
    
    // Generate comprehensive schema markup
    const schemaMarkup = generateComprehensiveSchema(frontmatter, slug, canonicalUrl, products, winners, relatedComparisons);
    const breadcrumbSchema = generateBreadcrumbSchema(slug, products);
    
    return `
<!DOCTYPE html>
<html lang="en" itemscope itemtype="https://schema.org/Article">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(frontmatter.title || formatComparisonSlug(slug))} | ReviewIndex Comparison</title>
    <meta name="description" content="${escapeHtml(frontmatter.description || `Detailed comparison of ${products.join(' vs ')}. Features, specs, prices, and expert analysis to help you choose the best product.`)}">
    <link rel="canonical" href="${canonicalUrl}">
    
    <!-- SEO Meta Tags -->
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    <meta name="keywords" content="${products.join(', ')}, ${products[0]} vs ${products[1]}, comparison, review, buy, price, features, specs">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}">
    <meta property="og:description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')} - Detailed analysis`)}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${escapeHtml(frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-1200x630.jpg')}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="ReviewIndex">
    <meta property="og:locale" content="en_US">
    <meta property="article:published_time" content="${frontmatter.date || new Date().toISOString()}">
    ${frontmatter.categories ? frontmatter.categories.map(cat => `<meta property="article:section" content="${escapeHtml(cat)}">`).join('') : ''}
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}">
    <meta name="twitter:description" content="${escapeHtml(frontmatter.description || `Compare ${products.join(' vs ')}`)}">
    <meta name="twitter:image" content="${escapeHtml(frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-1200x630.jpg')}">
    <meta name="twitter:site" content="@reviewindex">
    
    <!-- Additional Meta Tags -->
    <meta name="author" content="ReviewIndex">
    <meta name="theme-color" content="#2563eb">
    <link rel="icon" href="/favicon.ico">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    
    <!-- Preload Critical Resources -->
    <link rel="preload" href="${frontmatter.featured_image || 'https://reviewindex.pages.dev/default-comparison-1200x630.jpg'}" as="image">
    
    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    ${schemaMarkup}
    </script>
    <script type="application/ld+json">
    ${breadcrumbSchema}
    </script>
    
    <style>
        :root {
            --primary: #2563eb;
            --primary-dark: #1d4ed8;
            --primary-light: #dbeafe;
            --success: #059669;
            --success-light: #d1fae5;
            --warning: #d97706;
            --warning-light: #fef3c7;
            --error: #dc2626;
            --error-light: #fef2f2;
            --gray-50: #f9fafb;
            --gray-100: #f3f4f6;
            --gray-200: #e5e7eb;
            --gray-300: #d1d5db;
            --gray-400: #9ca3af;
            --gray-500: #6b7280;
            --gray-600: #4b5563;
            --gray-700: #374151;
            --gray-800: #1f2937;
            --gray-900: #111827;
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
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
            font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; 
            line-height: 1.7; 
            color: var(--gray-800);
            background: var(--gray-50);
            min-height: 100vh;
            font-size: 16px;
        }
        
        .container { 
            max-width: 1280px; 
            margin: 0 auto; 
            padding: 0 20px;
        }
        
        /* Skip to main content for accessibility */
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
        
        /* Breadcrumb Navigation */
        .breadcrumb {
            background: white;
            padding: 1rem 2rem;
            border-radius: 8px;
            margin: 1rem 0 2rem 0;
            box-shadow: var(--shadow-sm);
            border: 1px solid var(--gray-200);
            font-size: 0.9rem;
        }
        
        .breadcrumb ol {
            list-style: none;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 0.5rem;
        }
        
        .breadcrumb li {
            display: flex;
            align-items: center;
        }
        
        .breadcrumb li:not(:last-child)::after {
            content: "›";
            margin-left: 0.5rem;
            color: var(--gray-400);
        }
        
        .breadcrumb a {
            color: var(--primary);
            text-decoration: none;
            transition: color 0.2s;
        }
        
        .breadcrumb a:hover {
            color: var(--primary-dark);
            text-decoration: underline;
        }
        
        .breadcrumb [aria-current="page"] {
            color: var(--gray-600);
            font-weight: 500;
        }
        
        /* Header */
        .header { 
            background: white;
            padding: 3rem 2rem;
            text-align: center;
            border-radius: 12px;
            box-shadow: var(--shadow);
            margin: 1rem 0 2rem 0;
            border: 1px solid var(--gray-200);
            position: relative;
        }
        
        .header h1 {
            font-size: clamp(2rem, 5vw, 3rem);
            margin-bottom: 1rem;
            color: var(--gray-900);
            line-height: 1.2;
            font-weight: 800;
            letter-spacing: -0.025em;
        }
        
        .header .description {
            font-size: 1.25rem;
            color: var(--gray-600);
            max-width: 800px;
            margin: 0 auto;
            line-height: 1.6;
        }
        
        /* Summary Cards */
        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 1.5rem;
            margin: 3rem 0;
        }
        
        .summary-card {
            background: white;
            padding: 2rem;
            border-radius: 12px;
            box-shadow: var(--shadow);
            text-align: center;
            border: 1px solid var(--gray-200);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        
        .summary-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 4px;
            background: var(--gray-300);
        }
        
        .summary-card.winner::before {
            background: linear-gradient(135deg, var(--success), var(--primary));
        }
        
        .summary-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-lg);
        }
        
        .summary-card h3 {
            font-size: 1.1rem;
            margin-bottom: 1rem;
            color: var(--gray-700);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            font-weight: 600;
        }
        
        .summary-card .winner-name {
            font-size: 1.4rem;
            font-weight: 700;
            margin: 0.5rem 0;
            color: var(--gray-900);
        }
        
        .summary-card .winner-description {
            color: var(--gray-600);
            font-size: 0.95rem;
            line-height: 1.5;
        }
        
        /* Products Grid */
        .products-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 2.5rem;
            margin: 3rem 0;
        }
        
        .product-card {
            background: white;
            border-radius: 12px;
            padding: 0;
            box-shadow: var(--shadow);
            border: 1px solid var(--gray-200);
            overflow: hidden;
            transition: all 0.3s ease;
            position: relative;
        }
        
        .product-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-lg);
        }
        
        .product-header {
            background: linear-gradient(135deg, var(--primary-light), white);
            padding: 2.5rem 2rem;
            text-align: center;
            border-bottom: 1px solid var(--gray-200);
            position: relative;
        }
        
        .product-header h3 {
            font-size: 1.5rem;
            color: var(--gray-900);
            margin-bottom: 1rem;
            font-weight: 700;
        }
        
        .product-image {
            width: 200px;
            height: 200px;
            object-fit: contain;
            margin: 0 auto;
            display: block;
            border-radius: 8px;
            background: white;
            padding: 1rem;
            box-shadow: var(--shadow-md);
            transition: transform 0.3s ease;
        }
        
        .product-image:hover {
            transform: scale(1.05);
        }
        
        .product-price {
            font-size: 1.75rem;
            font-weight: 800;
            color: var(--success);
            margin: 1rem 0;
        }
        
        .product-rating {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            margin: 0.5rem 0;
            color: var(--warning);
            font-weight: 600;
        }
        
        .affiliate-section {
            text-align: center;
            padding: 2rem;
            background: var(--gray-50);
            border-radius: 8px;
            margin: 1.5rem 2rem;
        }
        
        .affiliate-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: var(--primary);
            color: white;
            padding: 1rem 2rem;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: all 0.3s ease;
            border: 2px solid var(--primary);
            font-size: 1.1rem;
            box-shadow: var(--shadow-md);
        }
        
        .affiliate-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
        }
        
        .affiliate-btn:active {
            transform: translateY(0);
        }
        
        /* Comparison Table */
        .comparison-section {
            background: white;
            border-radius: 12px;
            padding: 2.5rem;
            margin: 3rem 0;
            box-shadow: var(--shadow);
            border: 1px solid var(--gray-200);
        }
        
        .section-title {
            font-size: 1.75rem;
            margin-bottom: 1.5rem;
            color: var(--gray-900);
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-weight: 700;
        }
        
        .comparison-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            font-size: 0.95rem;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: var(--shadow-sm);
        }
        
        .comparison-table th {
            background: var(--primary);
            color: white;
            padding: 1.25rem 1rem;
            text-align: center;
            font-weight: 600;
            font-size: 1.1rem;
            border: 1px solid var(--primary-dark);
        }
        
        .comparison-table td {
            padding: 1.25rem 1rem;
            border: 1px solid var(--gray-200);
            vertical-align: top;
            text-align: center;
            line-height: 1.5;
        }
        
        .comparison-table .feature-cell {
            background: var(--gray-50);
            font-weight: 600;
            color: var(--gray-800);
            width: 200px;
            text-align: left;
            border-right: 2px solid var(--gray-200);
        }
        
        .comparison-table tr:nth-child(even) td:not(.feature-cell) {
            background: var(--gray-50);
        }
        
        .comparison-table tr:hover td:not(.feature-cell) {
            background: var(--primary-light);
        }
        
        /* Related Comparisons */
        .related-section {
            background: white;
            border-radius: 12px;
            padding: 2.5rem;
            margin: 3rem 0;
            box-shadow: var(--shadow);
            border: 1px solid var(--gray-200);
        }
        
        .related-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 1.5rem;
            margin-top: 1.5rem;
        }
        
        .related-card {
            background: var(--gray-50);
            border-radius: 8px;
            padding: 1.5rem;
            transition: all 0.3s ease;
            border: 1px solid var(--gray-200);
            text-decoration: none;
            color: inherit;
            display: block;
            position: relative;
            overflow: hidden;
        }
        
        .related-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--primary);
            transform: scaleX(0);
            transition: transform 0.3s ease;
        }
        
        .related-card:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-lg);
            background: white;
        }
        
        .related-card:hover::before {
            transform: scaleX(1);
        }
        
        .related-card h4 {
            color: var(--gray-900);
            margin-bottom: 0.75rem;
            font-size: 1.1rem;
            line-height: 1.4;
            font-weight: 600;
        }
        
        .related-card p {
            color: var(--gray-600);
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
            padding: 0.25rem 0.75rem;
            border-radius: 16px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .related-vs {
            color: var(--gray-500);
            font-weight: 700;
            font-size: 0.8rem;
        }
        
        /* Content Styling */
        .content {
            line-height: 1.8;
        }
        
        .content h2 {
            font-size: 1.75rem;
            margin: 3rem 0 1.5rem 0;
            color: var(--gray-900);
            padding-bottom: 0.5rem;
            border-bottom: 2px solid var(--gray-200);
            font-weight: 700;
        }
        
        .content h3 {
            font-size: 1.5rem;
            margin: 2.5rem 0 1rem 0;
            color: var(--gray-800);
            font-weight: 600;
        }
        
        .content p {
            margin-bottom: 1.5rem;
            line-height: 1.8;
            color: var(--gray-700);
        }
        
        .content img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            margin: 1.5rem 0;
            display: block;
            box-shadow: var(--shadow);
        }
        
        .content ul, .content ol {
            margin: 1.5rem 0;
            padding-left: 2rem;
        }
        
        .content li {
            margin-bottom: 0.5rem;
            line-height: 1.6;
        }
        
        /* Footer */
        .footer {
            text-align: center;
            padding: 3rem 2rem;
            color: var(--gray-600);
            margin-top: 4rem;
            border-top: 1px solid var(--gray-200);
            background: white;
            border-radius: 12px 12px 0 0;
        }
        
        .footer p {
            margin: 0.5rem 0;
        }
        
        .last-updated {
            font-size: 0.9rem;
            color: var(--gray-500);
            margin-top: 1rem;
        }
        
        /* Responsive Design */
        @media (max-width: 1024px) {
            .container {
                padding: 0 16px;
            }
            
            .products-grid {
                grid-template-columns: 1fr;
                gap: 2rem;
            }
        }
        
        @media (max-width: 768px) {
            .header {
                padding: 2rem 1rem;
            }
            
            .summary-cards {
                grid-template-columns: 1fr;
            }
            
            .comparison-section {
                padding: 1.5rem;
            }
            
            .related-grid {
                grid-template-columns: 1fr;
            }
            
            .comparison-table {
                font-size: 0.85rem;
                display: block;
                overflow-x: auto;
            }
            
            .breadcrumb {
                padding: 1rem;
            }
            
            .affiliate-btn {
                padding: 0.875rem 1.5rem;
                font-size: 1rem;
            }
        }
        
        @media (max-width: 480px) {
            .container {
                padding: 0 12px;
            }
            
            .product-header {
                padding: 1.5rem 1rem;
            }
            
            .product-image {
                width: 150px;
                height: 150px;
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
        
        /* Print Styles */
        @media print {
            .affiliate-btn, .breadcrumb, .related-section {
                display: none;
            }
            
            body {
                background: white;
                color: black;
                font-size: 12pt;
            }
            
            .container {
                max-width: none;
                padding: 0;
            }
            
            .header, .product-card, .comparison-section {
                box-shadow: none;
                border: 1px solid #ccc;
            }
        }
    </style>
</head>
<body>
    <a href="#main-content" class="skip-link">Skip to main content</a>
    
    <div class="container">
        <!-- Breadcrumb Navigation -->
        <nav class="breadcrumb" aria-label="Breadcrumb">
            <ol>
                <li><a href="/">Home</a></li>
                <li><a href="/comparisons">Comparisons</a></li>
                <li aria-current="page">${escapeHtml(products.join(' vs '))}</li>
            </ol>
        </nav>
        
        <header class="header" role="banner">
            <h1 itemprop="headline">${escapeHtml(frontmatter.title || formatComparisonSlug(slug))}</h1>
            ${frontmatter.description ? `<p class="description" itemprop="description">${escapeHtml(frontmatter.description)}</p>` : ''}
        </header>
        
        <main id="main-content" role="main" itemprop="mainEntity">
            <!-- Quick Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card ${winners.overall === products[0] ? 'winner' : ''}">
                    <h3>🏆 Overall Winner</h3>
                    <div class="winner-name">${winners.overall || products[0] || 'Check Comparison'}</div>
                    <p class="winner-description">${winners.overallDescription || 'Best all-around choice for most users'}</p>
                </div>
                
                <div class="summary-card ${winners.budget === products[1] ? 'winner' : ''}">
                    <h3>💰 Best Value</h3>
                    <div class="winner-name">${winners.budget || products[1] || products[0] || 'Check Comparison'}</div>
                    <p class="winner-description">${winners.budgetDescription || 'Great performance at competitive price'}</p>
                </div>
                
                <div class="summary-card ${winners.performance === products[0] ? 'winner' : ''}">
                    <h3>⚡ Performance King</h3>
                    <div class="winner-name">${winners.performance || products[0] || 'Check Comparison'}</div>
                    <p class="winner-description">${winners.performanceDescription || 'Top-tier performance for power users'}</p>
                </div>
            </div>
            
            <!-- Main Content -->
            <div class="content" itemprop="articleBody">
                ${htmlContent}
            </div>
            
            <!-- Related Comparisons -->
            ${relatedComparisons.length > 0 ? `
            <section class="related-section" aria-labelledby="related-title">
                <h2 class="section-title" id="related-title">🔗 Related Comparisons</h2>
                <p style="color: var(--gray-600); margin-bottom: 1.5rem;">You might also be interested in these related product comparisons</p>
                <div class="related-grid">
                    ${relatedComparisons.map(comp => `
                        <a href="/comparison/${comp.slug}" class="related-card" aria-label="Read comparison: ${escapeHtml(comp.title)}" itemprop="relatedLink">
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
        </main>
        
        <footer class="footer" role="contentinfo">
            <p>&copy; ${new Date().getFullYear()} ReviewIndex. All comparisons are independently researched and reviewed.</p>
            <p class="last-updated">Last updated: ${frontmatter.date ? new Date(frontmatter.date).toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            }) : 'Recently'}</p>
            <p><small>Prices and availability may change. Check affiliate links for current offers.</small></p>
        </footer>
    </div>
    
    <script>
        // Performance and UX enhancements
        document.addEventListener('DOMContentLoaded', function() {
            // Lazy load images
            const images = document.querySelectorAll('img');
            images.forEach(img => {
                img.setAttribute('loading', 'lazy');
                img.setAttribute('decoding', 'async');
                // Add error handling
                img.addEventListener('error', function() {
                    this.style.display = 'none';
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
            
            // Affiliate link tracking
            document.querySelectorAll('a[rel*="sponsored"]').forEach(link => {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'nofollow sponsored noopener');
            });
            
            // Add focus styles for keyboard navigation
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Tab') {
                    document.body.classList.add('keyboard-navigation');
                }
            });
            
            document.addEventListener('mousedown', function() {
                document.body.classList.remove('keyboard-navigation');
            });
        });
        
        // Add keyboard navigation styles
        const style = document.createElement('style');
        style.textContent = \`
            .keyboard-navigation *:focus {
                outline: 2px solid var(--primary);
                outline-offset: 2px;
            }
        \`;
        document.head.appendChild(style);
    </script>
</body>
</html>`;
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
                    
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    } else if (value.startsWith('[') && value.endsWith(']')) {
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
    // Enhanced markdown to HTML conversion with better structure
    let html = markdown
        .replace(/#### (.*?)\n/g, '<h4>$1</h4>')
        .replace(/### (.*?)\n/g, '<h3>$1</h3>')
        .replace(/## (.*?)\n/g, '<h2>$1</h2>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" class="product-image" loading="lazy" decoding="async">')
        .replace(/\[([^\]]+)\]\(([^)]+)\)\{: \.btn \.btn-primary\}/g, '<a href="$2" class="affiliate-btn" target="_blank" rel="nofollow sponsored noopener">$1</a>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
    
    // Wrap in paragraphs if not already
    if (!html.startsWith('<')) {
        html = '<p>' + html + '</p>';
    }
    
    return html;
}

function extractWinnersFromContent(content) {
    const winners = {};
    
    const overallMatch = content.match(/🏆 Overall Winner: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/);
    if (overallMatch) {
        winners.overall = overallMatch[1].trim();
        winners.overallDescription = overallMatch[2] ? overallMatch[2].trim() : '';
    }
    
    const budgetMatch = content.match(/💰 Best Value: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/);
    if (budgetMatch) {
        winners.budget = budgetMatch[1].trim();
        winners.budgetDescription = budgetMatch[2] ? budgetMatch[2].trim() : '';
    }
    
    const performanceMatch = content.match(/⚡ Performance King: ([^\n*]+)(?:\n\*([^\n*]+)\*)?/);
    if (performanceMatch) {
        winners.performance = performanceMatch[1].trim();
        winners.performanceDescription = performanceMatch[2] ? performanceMatch[2].trim() : '';
    }
    
    return winners;
}

function generateComprehensiveSchema(frontmatter, slug, canonicalUrl, products, winners, relatedComparisons) {
    const currentDate = new Date().toISOString();
    const publishDate = frontmatter.date || currentDate;
    
    const schema = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": frontmatter.title || formatComparisonSlug(slug),
        "description": frontmatter.description,
        "image": frontmatter.featured_image ? [frontmatter.featured_image] : [],
        "datePublished": publishDate,
        "dateModified": publishDate,
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
            "cssSelector": [".header h1", ".summary-cards"]
        },
        "articleSection": frontmatter.categories ? frontmatter.categories.join(', ') : "Product Comparisons",
        "keywords": products.join(', ') + ", comparison, review",
        "about": products.map(product => ({
            "@type": "Product",
            "name": product
        }))
    };

    return JSON.stringify(schema, null, 2);
}

function generateBreadcrumbSchema(slug, products) {
    return JSON.stringify({
        "@context": "https://schema.org",
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
                "name": products.join(' vs '),
                "item": `https://reviewindex.pages.dev/comparison/${slug}`
            }
        ]
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
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
