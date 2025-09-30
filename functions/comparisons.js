// functions/comparisons.js
export async function onRequest(context) {
    const { request, env } = context;
    
    try {
        // Get URL parameters for search
        const url = new URL(request.url);
        const searchQuery = url.searchParams.get('search') || '';
        
        // Fetch comparison data with caching and limits
        const comparisonData = await fetchComparisonData(env.GITHUB_TOKEN);
        
        if (!comparisonData || comparisonData.length === 0) {
            return renderErrorPage('No comparisons found', 'There are no product comparisons available at the moment.');
        }

        // Get latest 12 comparisons with full data for featured section
        const latestComparisons = comparisonData.slice(0, 12);

        // Filter comparisons based on search
        let searchResults = [];
        let showingResults = false;
        
        if (searchQuery.trim()) {
            searchResults = filterComparisonsBySearch(comparisonData, searchQuery);
            showingResults = true;
        }

        // Render the comparisons listing page
        const htmlContent = renderComparisonsPage(
            searchResults,
            latestComparisons,
            comparisonData, // Pass all data for client-side search
            {
                searchQuery,
                showingResults,
                totalResults: searchResults.length,
                totalComparisons: comparisonData.length
            },
            request.url
        );
        
        return new Response(htmlContent, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=10800', // 3 hours cache
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            }
        });

    } catch (error) {
        console.error('Error rendering comparisons page:', error);
        return renderErrorPage('Server Error', 'An error occurred while loading the comparisons.');
    }
}

async function fetchComparisonData(githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const CACHE_KEY = 'comparisons-optimized-data';
    
    try {
        // Try to get from cache first
        const cache = caches.default;
        const cacheUrl = new URL(`https://cache.reviewindex.pages.dev/${CACHE_KEY}`);
        let cachedResponse = await cache.match(cacheUrl);
        
        if (cachedResponse) {
            console.log('✅ COMPARISONS Cache HIT');
            return await cachedResponse.json();
        }
        
        console.log('🔄 COMPARISONS Cache MISS - fetching fresh data');
        
        // SINGLE API CALL - Get repository tree with recursive option
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/main?recursive=1`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (response.status === 200) {
            const treeData = await response.json();
            
            // Extract comparison files from the tree
            const comparisonFiles = treeData.tree
                .filter(item => 
                    item.type === 'blob' &&
                    item.path.startsWith('content/comparisons/') && 
                    item.path.endsWith('.md')
                )
                .sort((a, b) => b.path.localeCompare(a.path)) // Sort by path (newest first)
                .slice(0, 50); // Limit to 50 most recent files for performance

            console.log(`📊 Processing ${comparisonFiles.length} comparison files`);

            const comparisons = [];
            
            // Process only the limited number of files
            for (const file of comparisonFiles) {
                try {
                    // Construct download URL
                    const downloadUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${file.path}`;
                    
                    const fileResponse = await fetch(downloadUrl, {
                        headers: {
                            'Authorization': `token ${githubToken}`,
                            'User-Agent': 'Review-Index-App'
                        }
                    });
                    
                    if (fileResponse.status === 200) {
                        const content = await fileResponse.text();
                        const { frontmatter } = parseComparisonMarkdown(content);
                        
                        const slug = file.path.split('/').pop().replace('.md', '');
                        
                        comparisons.push({
                            slug: slug,
                            title: frontmatter.title || formatSlugToTitle(slug),
                            description: frontmatter.description || `Compare ${frontmatter.comparison_products?.join(' vs ') || 'products'}`,
                            categories: Array.isArray(frontmatter.categories) ? frontmatter.categories : 
                                      (frontmatter.categories ? [frontmatter.categories] : ['comparisons']),
                            products: frontmatter.comparison_products || extractProductsFromSlug(slug),
                            featured_image: frontmatter.featured_image || getDefaultImage(frontmatter.comparison_products || extractProductsFromSlug(slug)),
                            date: frontmatter.date || new Date().toISOString(),
                            last_modified: file.last_modified || new Date().toISOString()
                        });
                    }
                } catch (error) {
                    console.error(`Error processing comparison ${file.path}:`, error);
                    // Create basic entry even if content fetch fails
                    const slug = file.path.split('/').pop().replace('.md', '');
                    comparisons.push({
                        slug: slug,
                        title: formatSlugToTitle(slug),
                        description: `Product comparison: ${formatSlugToTitle(slug)}`,
                        categories: ['comparisons'],
                        products: extractProductsFromSlug(slug),
                        featured_image: getDefaultImage(extractProductsFromSlug(slug)),
                        date: file.last_modified || new Date().toISOString(),
                        last_modified: file.last_modified || new Date().toISOString()
                    });
                }
            }
            
            // Sort by date for consistent ordering
            comparisons.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            console.log(`✅ Processed ${comparisons.length} comparisons`);
            
            // Store in cache for 3 hours
            const cacheResponse = new Response(JSON.stringify(comparisons), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=10800'
                }
            });
            
            context.waitUntil(cache.put(cacheUrl, cacheResponse.clone()));
            
            return comparisons;
        }
        return [];
    } catch (error) {
        console.error('Error fetching comparison data:', error);
        return [];
    }
}

function extractProductsFromSlug(slug) {
    // Extract product names from slug (e.g., "iphone-15-vs-samsung-s24" -> ["iPhone 15", "Samsung S24"])
    const parts = slug.split('-vs-');
    return parts.map(part => 
        part.split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    );
}

function filterComparisonsBySearch(comparisons, searchQuery) {
    if (!searchQuery.trim()) return [];
    
    const query = searchQuery.toLowerCase().trim();
    
    return comparisons.filter(comp => {
        // Search in title
        if (comp.title.toLowerCase().includes(query)) return true;
        
        // Search in description
        if (comp.description.toLowerCase().includes(query)) return true;
        
        // Search in product names
        if (comp.products.some(product => product.toLowerCase().includes(query))) return true;
        
        // Search in categories
        if (comp.categories.some(category => category.toLowerCase().includes(query))) return true;
        
        return false;
    }).slice(0, 20); // Limit results for performance
}

function getDefaultImage(products) {
    // Generate a placeholder image based on product names
    if (products && products.length > 0) {
        const productNames = products.join('+vs+');
        return `https://via.placeholder.com/400x200/3B82F6/FFFFFF?text=${encodeURIComponent(productNames)}`;
    }
    return 'https://via.placeholder.com/400x200/3B82F6/FFFFFF?text=Product+Comparison';
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
                    } else if (value.startsWith("'") && value.endsWith("'")) {
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

function renderComparisonsPage(searchResults, latestComparisons, allComparisons, filters, requestUrl) {
    const canonicalUrl = `https://reviewindex.pages.dev/comparisons`;
    const searchTitle = filters.searchQuery ? `Search Results for "${filters.searchQuery}"` : 'Product Comparisons';
    
    // Generate dynamic meta description
    const metaDescription = filters.searchQuery 
        ? `Search results for "${filters.searchQuery}" - Find detailed product comparisons and buying guides. ${filters.totalResults} comparison${filters.totalResults !== 1 ? 's' : ''} found.`
        : `Browse ${filters.totalComparisons}+ detailed product comparisons. Compare specs, prices, features and make informed buying decisions. Expert vs comparisons.`;

    // Extract all product names for search suggestions and keywords
    const allProducts = new Set();
    allComparisons.forEach(comp => {
        comp.products.forEach(product => allProducts.add(product));
    });
    
    const topProducts = Array.from(allProducts).slice(0, 15).join(', ');
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(searchTitle)} - Product Comparison Tool | ReviewIndex</title>
    <meta name="description" content="${escapeHtml(metaDescription)}">
    <link rel="canonical" href="${canonicalUrl}${filters.searchQuery ? `?search=${encodeURIComponent(filters.searchQuery)}` : ''}">
    
    <!-- SEO Meta Tags -->
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    <meta name="keywords" content="product comparisons, compare products, buying guide, vs, ${topProducts}, which is better, product vs product">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(searchTitle)} - ReviewIndex Product Comparisons">
    <meta property="og:description" content="${escapeHtml(metaDescription)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="${latestComparisons[0]?.featured_image || 'https://reviewindex.pages.dev/og-comparisons.jpg'}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(searchTitle)} - ReviewIndex">
    <meta name="twitter:description" content="${escapeHtml(metaDescription)}">
    <meta name="twitter:image" content="${latestComparisons[0]?.featured_image || 'https://reviewindex.pages.dev/og-comparisons.jpg'}">
    
    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "Product Comparisons - ReviewIndex",
        "description": "${escapeHtml(metaDescription)}",
        "url": "${canonicalUrl}",
        "mainEntity": {
            "@type": "ItemList",
            "numberOfItems": ${filters.totalComparisons},
            "itemListElement": [
                ${latestComparisons.slice(0, 10).map((comp, index) => `
                {
                    "@type": "ListItem",
                    "position": ${index + 1},
                    "item": {
                        "@type": "Article",
                        "headline": "${escapeHtml(comp.title)}",
                        "description": "${escapeHtml(comp.description)}",
                        "image": "${escapeHtml(comp.featured_image)}",
                        "url": "https://reviewindex.pages.dev/comparison/${comp.slug}",
                        "datePublished": "${comp.date}",
                        "author": {
                            "@type": "Organization",
                            "name": "ReviewIndex"
                        },
                        "articleSection": "Product Comparisons"
                    }
                }`).join(',')}
            ]
        },
        "publisher": {
            "@type": "Organization",
            "name": "ReviewIndex",
            "url": "https://reviewindex.pages.dev",
            "logo": {
                "@type": "ImageObject",
                "url": "https://reviewindex.pages.dev/logo.png"
            }
        }
    }
    </script>
    
    <style>
        :root {
            --primary: #3b82f6;
            --primary-dark: #2563eb;
            --primary-light: #dbeafe;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --light: #f8fafc;
            --dark: #1e293b;
            --border: #e2e8f0;
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            --radius: 12px;
        }
        
        * { 
            margin: 0; 
            padding: 0; 
            box-sizing: border-box; 
        }
        
        body { 
            font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif; 
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
            padding: 4rem 2rem;
            text-align: center;
            border-radius: 20px;
            box-shadow: var(--shadow);
            margin: 2rem 0;
            border: 1px solid var(--border);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .header h1 {
            font-size: clamp(2rem, 5vw, 3rem);
            margin-bottom: 1rem;
            line-height: 1.2;
            font-weight: 700;
        }
        
        .header .description {
            font-size: 1.3rem;
            opacity: 0.9;
            max-width: 600px;
            margin: 0 auto 2rem;
        }
        
        /* Search Section */
        .search-section {
            background: white;
            padding: 2.5rem;
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            margin: 2rem 0;
            border: 1px solid var(--border);
            position: relative;
        }
        
        .search-form {
            max-width: 600px;
            margin: 0 auto;
            position: relative;
        }
        
        .search-input-group {
            display: flex;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        
        .search-input {
            flex: 1;
            padding: 1rem 1.5rem;
            border: 2px solid var(--border);
            border-radius: var(--radius);
            font-size: 1.1rem;
            transition: all 0.3s ease;
        }
        
        .search-input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px var(--primary-light);
        }
        
        .search-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 1rem 2rem;
            border-radius: var(--radius);
            font-size: 1.1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .search-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }
        
        .search-suggestions {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: white;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow-lg);
            max-height: 300px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
        }
        
        .suggestion-item {
            padding: 1rem 1.5rem;
            cursor: pointer;
            border-bottom: 1px solid var(--border);
            transition: background-color 0.2s ease;
        }
        
        .suggestion-item:hover {
            background: var(--light);
        }
        
        .suggestion-item:last-child {
            border-bottom: none;
        }
        
        /* Results Section */
        .results-section {
            background: white;
            padding: 2.5rem;
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            margin: 2rem 0;
            border: 1px solid var(--border);
        }
        
        .results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .results-count {
            color: #64748b;
            font-size: 1.1rem;
        }
        
        .no-results {
            text-align: center;
            padding: 3rem 2rem;
            color: #64748b;
        }
        
        .no-results h3 {
            font-size: 1.5rem;
            margin-bottom: 1rem;
            color: var(--dark);
        }
        
        /* Comparisons Grid */
        .comparisons-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 2rem;
            margin: 2rem 0;
        }
        
        .comparison-card {
            background: white;
            border-radius: var(--radius);
            overflow: hidden;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            transition: all 0.3s ease;
            text-decoration: none;
            color: inherit;
            display: block;
        }
        
        .comparison-card:hover {
            transform: translateY(-8px);
            box-shadow: var(--shadow-lg);
        }
        
        .card-image {
            width: 100%;
            height: 200px;
            object-fit: cover;
            background: var(--light);
        }
        
        .card-content {
            padding: 1.5rem;
        }
        
        .card-title {
            font-size: 1.3rem;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 0.75rem;
            line-height: 1.4;
        }
        
        .card-description {
            color: #64748b;
            margin-bottom: 1rem;
            line-height: 1.5;
        }
        
        .card-products {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-bottom: 1rem;
        }
        
        .product-badge {
            background: var(--primary);
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .vs-text {
            color: #94a3b8;
            font-weight: 600;
            font-size: 0.8rem;
        }
        
        .card-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 1rem;
            border-top: 1px solid var(--border);
            font-size: 0.85rem;
            color: #94a3b8;
        }
        
        /* Featured Section */
        .featured-section {
            background: white;
            padding: 2.5rem;
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            margin: 3rem 0;
            border: 1px solid var(--border);
        }
        
        .section-title {
            font-size: 2rem;
            margin-bottom: 2rem;
            color: var(--dark);
            text-align: center;
        }
        
        .section-subtitle {
            text-align: center;
            color: #64748b;
            margin-bottom: 2rem;
            font-size: 1.1rem;
        }
        
        /* Stats Section */
        .stats-section {
            background: white;
            padding: 2rem;
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            margin: 2rem 0;
            border: 1px solid var(--border);
            text-align: center;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            margin-top: 1.5rem;
        }
        
        .stat-item {
            padding: 1.5rem;
        }
        
        .stat-number {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--primary);
            display: block;
        }
        
        .stat-label {
            color: #64748b;
            font-size: 0.9rem;
        }
        
        /* Footer */
        .footer {
            text-align: center;
            padding: 3rem 2rem;
            color: #64748b;
            margin-top: 3rem;
            border-top: 1px solid var(--border);
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            .container {
                padding: 0 15px;
            }
            
            .header {
                padding: 3rem 1rem;
            }
            
            .search-section,
            .results-section,
            .featured-section {
                padding: 1.5rem;
            }
            
            .search-input-group {
                flex-direction: column;
            }
            
            .comparisons-grid {
                grid-template-columns: 1fr;
            }
            
            .results-header {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Main Header -->
        <header class="header" role="banner">
            <h1>🔍 Product Comparison Tool</h1>
            <p class="description">Compare products side-by-side with detailed specs, prices, and expert analysis. Make informed buying decisions.</p>
            
            <!-- Search Form -->
            <div class="search-form">
                <form action="/comparisons" method="GET" role="search">
                    <div class="search-input-group">
                        <input 
                            type="text" 
                            name="search" 
                            class="search-input" 
                            placeholder="Search ${filters.totalComparisons}+ comparisons (e.g., iPhone vs Samsung, Laptop comparison...)" 
                            value="${escapeHtml(filters.searchQuery)}"
                            aria-label="Search product comparisons"
                            id="searchInput"
                            autocomplete="off"
                        >
                        <button type="submit" class="search-btn">Search</button>
                    </div>
                </form>
                <div class="search-suggestions" id="searchSuggestions">
                    <!-- Dynamic suggestions will appear here -->
                </div>
            </div>
        </header>
        
        <!-- Quick Stats -->
        <section class="stats-section" aria-labelledby="stats-title">
            <h2 id="stats-title" class="hidden">Comparison Statistics</h2>
            <div class="stats-grid">
                <div class="stat-item">
                    <span class="stat-number">${filters.totalComparisons}+</span>
                    <span class="stat-label">Detailed Comparisons</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${Array.from(allProducts).length}+</span>
                    <span class="stat-label">Products Compared</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">100%</span>
                    <span class="stat-label">Unbiased Analysis</span>
                </div>
            </div>
        </section>
        
        <!-- Search Results -->
        ${filters.showingResults ? `
        <section class="results-section" aria-labelledby="search-results-title">
            <div class="results-header">
                <h2 id="search-results-title">Search Results for "${escapeHtml(filters.searchQuery)}"</h2>
                <div class="results-count">${filters.totalResults} comparison${filters.totalResults !== 1 ? 's' : ''} found</div>
            </div>
            
            ${filters.totalResults > 0 ? `
            <div class="comparisons-grid">
                ${searchResults.map(comp => `
                    <a href="/comparison/${comp.slug}" class="comparison-card" aria-label="View comparison: ${escapeHtml(comp.title)}">
                        <img src="${escapeHtml(comp.featured_image)}" alt="${escapeHtml(comp.title)}" class="card-image" loading="lazy">
                        <div class="card-content">
                            <h3 class="card-title">${escapeHtml(comp.title)}</h3>
                            <p class="card-description">${escapeHtml(comp.description)}</p>
                            ${comp.products.length > 0 ? `
                            <div class="card-products">
                                ${comp.products.map((product, index) => `
                                    <span class="product-badge">${escapeHtml(product)}</span>
                                    ${index < comp.products.length - 1 ? '<span class="vs-text">vs</span>' : ''}
                                `).join('')}
                            </div>
                            ` : ''}
                            <div class="card-meta">
                                <span>${formatDate(comp.date)}</span>
                                <span>${comp.categories[0] || 'Comparison'}</span>
                            </div>
                        </div>
                    </a>
                `).join('')}
            </div>
            ` : `
            <div class="no-results">
                <h3>No comparisons found for "${escapeHtml(filters.searchQuery)}"</h3>
                <p>Try searching with different keywords or browse our latest comparisons below.</p>
                <p><strong>Popular searches:</strong> iPhone vs Samsung, MacBook vs Windows, PlayStation vs Xbox</p>
            </div>
            `}
        </section>
        ` : ''}
        
        <!-- Featured Comparisons (Latest 12) -->
        <section class="featured-section" aria-labelledby="featured-title">
            <h2 class="section-title" id="featured-title">📈 Latest Product Comparisons</h2>
            <p class="section-subtitle">
                Recently added comparisons with detailed analysis, specs, and buying recommendations
            </p>
            
            <div class="comparisons-grid">
                ${latestComparisons.map(comp => `
                    <a href="/comparison/${comp.slug}" class="comparison-card" aria-label="View comparison: ${escapeHtml(comp.title)}">
                        <img src="${escapeHtml(comp.featured_image)}" alt="${escapeHtml(comp.title)}" class="card-image" loading="lazy">
                        <div class="card-content">
                            <h3 class="card-title">${escapeHtml(comp.title)}</h3>
                            <p class="card-description">${escapeHtml(comp.description)}</p>
                            ${comp.products.length > 0 ? `
                            <div class="card-products">
                                ${comp.products.map((product, index) => `
                                    <span class="product-badge">${escapeHtml(product)}</span>
                                    ${index < comp.products.length - 1 ? '<span class="vs-text">vs</span>' : ''}
                                `).join('')}
                            </div>
                            ` : ''}
                            <div class="card-meta">
                                <span>${formatDate(comp.date)}</span>
                                <span>${comp.categories[0] || 'Comparison'}</span>
                            </div>
                        </div>
                    </a>
                `).join('')}
            </div>
        </section>
        
        <footer class="footer" role="contentinfo">
            <p>© ${new Date().getFullYear()} ReviewIndex. All comparisons are independently researched and regularly updated.</p>
            <p>Total comparisons available: ${filters.totalComparisons}+ products compared</p>
        </footer>
    </div>
    
    <script>
        // All comparisons data for client-side search
        const allComparisons = ${JSON.stringify(allComparisons)};
        
        // Enhanced search functionality
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('searchInput');
            const searchSuggestions = document.getElementById('searchSuggestions');
            const searchForm = document.querySelector('form[role="search"]');
            
            // Focus search input on page load
            if (searchInput && !searchInput.value) {
                searchInput.focus();
            }
            
            // Real-time search suggestions
            if (searchInput && searchSuggestions) {
                searchInput.addEventListener('input', function() {
                    const query = this.value.trim().toLowerCase();
                    
                    if (query.length < 2) {
                        searchSuggestions.style.display = 'none';
                        return;
                    }
                    
                    // Filter comparisons for suggestions
                    const suggestions = allComparisons.filter(comp => {
                        return comp.title.toLowerCase().includes(query) ||
                               comp.products.some(product => product.toLowerCase().includes(query)) ||
                               comp.description.toLowerCase().includes(query);
                    }).slice(0, 8); // Limit to 8 suggestions
                    
                    if (suggestions.length > 0) {
                        searchSuggestions.innerHTML = suggestions.map(comp => \`
                            <div class="suggestion-item" onclick="selectSuggestion('\${escapeJs(comp.title)}')">
                                <strong>\${escapeJs(comp.title)}</strong>
                                <div style="font-size: 0.9rem; color: #666; margin-top: 0.25rem;">
                                    \${comp.products.join(' vs ')}
                                </div>
                            </div>
                        \`).join('');
                        searchSuggestions.style.display = 'block';
                    } else {
                        searchSuggestions.style.display = 'none';
                    }
                });
                
                // Hide suggestions when clicking outside
                document.addEventListener('click', function(e) {
                    if (!searchInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
                        searchSuggestions.style.display = 'none';
                    }
                });
            }
            
            // Handle form submission
            if (searchForm) {
                searchForm.addEventListener('submit', function(e) {
                    const searchValue = searchInput.value.trim();
                    if (!searchValue) {
                        e.preventDefault();
                        searchInput.focus();
                    }
                });
            }
        });
        
        function selectSuggestion(query) {
            document.getElementById('searchInput').value = query;
            document.getElementById('searchSuggestions').style.display = 'none';
            document.querySelector('form[role="search"]').submit();
        }
        
        function escapeJs(unsafe) {
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }
    </script>
</body>
</html>`;
}

// Helper functions
function formatSlugToTitle(slug) {
    return slug.split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .replace(/ Vs /gi, ' vs ');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
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
        <a href="/comparisons" style="margin-left: 1rem;">View Comparisons</a>
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
