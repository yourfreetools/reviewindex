// functions/comparisons.js
export async function onRequest(context) {
    const { request, env } = context;
    
    // Handle GET requests for comparisons page
    const cacheKey = new Request(request.url, request);
    const cache = caches.default;
    
    // Try to get from cache first (3 hours cache)
    let response = await cache.match(cacheKey);
    if (response) {
        console.log('✅ COMPARISONS Cache HIT - Serving from cache');
        return response;
    }
    console.log('🔄 COMPARISONS Cache MISS - fetching fresh data');
    
    try {
        // Get latest 8 comparison posts from GitHub
        const latestComparisons = await fetchLatestComparisons(env.GITHUB_TOKEN);
        
        // Get all comparison names for search
        const allComparisonNames = await getAllComparisonNames(env.GITHUB_TOKEN);
        
        // Generate the complete HTML with full SEO
        const html = generateComparisonsHTML(latestComparisons, allComparisonNames);
        
        // Create response with 3-hour cache headers
        response = new Response(html, {
            headers: { 
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=10800', // 3 hours in seconds
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY'
            }
        });
        
        // Store in cache for future requests (3 hours)
        context.waitUntil(cache.put(cacheKey, response.clone()));
        console.log('✅ Fresh comparisons data fetched and cached for 3 hours');
        return response;

    } catch (error) {
        console.error('Error generating comparisons page:', error);
        return renderErrorPage();
    }
}

// Fetch only 8 latest comparisons with full content
async function fetchLatestComparisons(githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        console.log('📡 Fetching 8 latest comparisons...');
        
        // Get list of files in comparisons directory
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/comparisons`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'ReviewIndex-App',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const files = await response.json();
        
        // Take only latest 8 files
        const latestFiles = files
            .filter(file => file.name.endsWith('.md'))
            .slice(0, 8);

        const comparisons = [];
        
        // Fetch content for only these 8 comparisons
        for (const file of latestFiles) {
            try {
                const comparisonResponse = await fetch(file.download_url, {
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'User-Agent': 'ReviewIndex-App'
                    }
                });
                
                if (comparisonResponse.ok) {
                    const content = await comparisonResponse.text();
                    const { frontmatter } = parseComparisonMarkdown(content);
                    
                    comparisons.push({
                        slug: file.name.replace('.md', ''),
                        title: frontmatter.title || formatComparisonSlug(file.name.replace('.md', '')),
                        description: frontmatter.description || `Compare ${frontmatter.comparison_products ? frontmatter.comparison_products.join(' vs ') : 'products'}`,
                        date: frontmatter.date || 'Recent',
                        image: frontmatter.featured_image || generateComparisonImage(frontmatter.comparison_products),
                        products: frontmatter.comparison_products || [],
                        categories: frontmatter.categories || ['comparisons']
                    });
                }
            } catch (error) {
                console.error(`Error processing comparison file ${file.name}:`, error);
                // Fallback with basic info
                comparisons.push({
                    slug: file.name.replace('.md', ''),
                    title: formatComparisonSlug(file.name.replace('.md', '')),
                    description: 'Detailed product comparison and analysis',
                    date: 'Recent',
                    image: generateComparisonImage([]),
                    products: [],
                    categories: ['comparisons']
                });
            }
        }
        
        console.log(`✅ Processed ${comparisons.length} latest comparisons`);
        return comparisons;

    } catch (error) {
        console.error('❌ Error fetching latest comparisons:', error);
        return [];
    }
}

// Get all comparison names for search
async function getAllComparisonNames(githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        // Single API call to get repository structure
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/main?recursive=1`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'ReviewIndex-App',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (!response.ok) {
            return [];
        }

        const treeData = await response.json();
        
        // Extract just the comparison names and slugs
        const comparisonNames = treeData.tree
            .filter(item => 
                item.type === 'blob' &&
                item.path.startsWith('content/comparisons/') && 
                item.path.endsWith('.md')
            )
            .map(file => {
                const filename = file.path.split('/').pop().replace('.md', '');
                return {
                    slug: filename,
                    title: formatComparisonSlug(filename)
                };
            })
            .sort((a, b) => b.slug.localeCompare(a.slug));

        console.log(`✅ Found ${comparisonNames.length} comparison names for search`);
        return comparisonNames;

    } catch (error) {
        console.error('Error fetching comparison names:', error);
        return [];
    }
}

function generateComparisonsHTML(latestComparisons, allComparisonNames) {
    const totalComparisons = allComparisonNames.length;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Product Comparisons - Side-by-Side Reviews & Buying Guides | ReviewIndex</title>
    <meta name="description" content="Compare products side-by-side with our detailed comparison reviews. Find which product is better for your needs with expert analysis and real-world testing.">
    <meta name="keywords" content="product comparisons, vs reviews, which is better, side-by-side comparison, buying guide, product vs">
    <meta name="author" content="ReviewIndex">
    
    <!-- Essential SEO Meta Tags -->
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
    <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    <meta name="bingbot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">

    <!-- Canonical URL -->
    <link rel="canonical" href="https://reviewindex.pages.dev/comparisons">
    <link rel="icon" type="image/png" href="/icon.png">

    <!-- Open Graph -->
    <meta property="og:title" content="Product Comparisons - Side-by-Side Reviews & Buying Guides">
    <meta property="og:description" content="Compare products side-by-side with detailed comparison reviews and expert analysis.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://reviewindex.pages.dev/comparisons">
    <meta property="og:image" content="https://reviewindex.pages.dev/comparisons-og.jpg">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Product Comparisons - ReviewIndex">
    <meta name="twitter:description" content="Side-by-side product comparisons and buying guides">
    
    <!-- Schema.org Structured Data -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "Product Comparisons",
        "description": "Side-by-side product comparison reviews and buying guides",
        "url": "https://reviewindex.pages.dev/comparisons",
        "mainEntity": {
            "@type": "ItemList",
            "numberOfItems": ${totalComparisons},
            "itemListElement": [
                ${latestComparisons.map((comp, index) => `
                {
                    "@type": "ListItem",
                    "position": ${index + 1},
                    "item": {
                        "@type": "Article",
                        "name": "${escapeHtml(comp.title)}",
                        "description": "${escapeHtml(comp.description)}",
                        "url": "https://reviewindex.pages.dev/comparison/${escapeHtml(comp.slug)}"
                    }
                }`).join(',')}
            ]
        }
    }
    </script>
    
    <style>
        :root {
            --primary: #2563eb;
            --primary-dark: #1d4ed8;
            --primary-light: #dbeafe;
            --secondary: #f59e0b;
            --success: #10b981;
            --gray-50: #f9fafb;
            --gray-100: #f3f4f6;
            --gray-200: #e5e7eb;
            --gray-600: #4b5563;
            --gray-800: #1f2937;
            --gray-900: #111827;
            --white: #ffffff;
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            --radius: 12px;
            --transition: all 0.3s ease;
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
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: var(--gray-800);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
        }

        /* Header Styles */
        header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid var(--gray-200);
            position: sticky;
            top: 0;
            z-index: 1000;
        }

        .navbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
        }

        .logo {
            font-size: 1.8rem;
            font-weight: 700;
            color: var(--primary);
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .logo-icon {
            font-size: 2rem;
        }

        .nav-links {
            display: flex;
            gap: 2rem;
            list-style: none;
        }

        .nav-links a {
            text-decoration: none;
            color: var(--gray-600);
            font-weight: 500;
            transition: var(--transition);
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
        }

        .nav-links a:hover {
            color: var(--primary);
            background: var(--primary-light);
        }

        .nav-links a.active {
            color: var(--primary);
            background: var(--primary-light);
            font-weight: 600;
        }

        /* Hero Section */
        .hero {
            text-align: center;
            padding: 4rem 0;
            color: white;
        }

        .hero h1 {
            font-size: 3.5rem;
            font-weight: 700;
            margin-bottom: 1rem;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .hero p {
            font-size: 1.3rem;
            margin-bottom: 2rem;
            opacity: 0.9;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }

        .search-box {
            max-width: 500px;
            margin: 0 auto;
            position: relative;
        }

        .search-box input {
            width: 100%;
            padding: 1rem 1.5rem;
            border: none;
            border-radius: 50px;
            font-size: 1.1rem;
            box-shadow: var(--shadow-lg);
        }

        .search-box button {
            position: absolute;
            right: 5px;
            top: 5px;
            background: var(--primary);
            color: white;
            border: none;
            padding: 0.8rem 1.5rem;
            border-radius: 50px;
            cursor: pointer;
            transition: var(--transition);
        }

        .search-box button:hover {
            background: var(--primary-dark);
        }

        /* Search Suggestions */
        .search-suggestions {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: white;
            border-radius: 0 0 10px 10px;
            box-shadow: var(--shadow-lg);
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
        }

        .suggestion-item {
            padding: 0.8rem 1rem;
            cursor: pointer;
            border-bottom: 1px solid var(--gray-200);
            transition: var(--transition);
        }

        .suggestion-item:hover {
            background: var(--gray-50);
        }

        .suggestion-item:last-child {
            border-bottom: none;
        }

        /* Main Content */
        .main-content {
            background: var(--white);
            border-radius: 20px 20px 0 0;
            margin-top: -2rem;
            position: relative;
            box-shadow: 0 -10px 30px rgba(0,0,0,0.1);
        }

        .content-wrapper {
            padding: 3rem 0;
        }

        .section-title {
            font-size: 2.5rem;
            text-align: center;
            margin-bottom: 1rem;
            color: var(--gray-900);
        }

        .section-subtitle {
            text-align: center;
            color: var(--gray-600);
            margin-bottom: 3rem;
            font-size: 1.2rem;
        }

        .stats-bar {
            display: flex;
            justify-content: center;
            gap: 2rem;
            margin-bottom: 3rem;
            flex-wrap: wrap;
        }

        .stat-item {
            text-align: center;
            padding: 1rem 2rem;
            background: var(--gray-50);
            border-radius: var(--radius);
            border: 1px solid var(--gray-200);
        }

        .stat-number {
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary);
            display: block;
        }

        .stat-label {
            color: var(--gray-600);
            font-size: 0.9rem;
        }

        /* Comparisons Grid */
        .comparisons-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }

        .comparison-card {
            background: var(--white);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            transition: var(--transition);
            overflow: hidden;
            border: 1px solid var(--gray-200);
            display: flex;
            flex-direction: column;
            position: relative;
        }

        .comparison-card:hover {
            transform: translateY(-8px);
            box-shadow: var(--shadow-lg);
        }

        .comparison-card::before {
            content: 'VS';
            position: absolute;
            top: 15px;
            right: 15px;
            background: var(--primary);
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 700;
            z-index: 2;
        }

        .comparison-image {
            width: 100%;
            height: 220px;
            object-fit: cover;
            background: linear-gradient(45deg, var(--gray-100), var(--gray-200));
        }

        .comparison-content {
            padding: 1.5rem;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
        }

        .comparison-title {
            font-size: 1.4rem;
            font-weight: 600;
            margin-bottom: 0.8rem;
            line-height: 1.4;
        }

        .comparison-title a {
            color: var(--gray-900);
            text-decoration: none;
            transition: var(--transition);
        }

        .comparison-title a:hover {
            color: var(--primary);
        }

        .comparison-products {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 1rem;
            flex-wrap: wrap;
        }

        .product-badge {
            background: var(--primary-light);
            color: var(--primary-dark);
            padding: 0.3rem 0.8rem;
            border-radius: 15px;
            font-size: 0.8rem;
            font-weight: 500;
        }

        .vs-separator {
            color: var(--gray-500);
            font-weight: 700;
            font-size: 0.9rem;
        }

        .comparison-excerpt {
            color: var(--gray-600);
            margin-bottom: 1.5rem;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            flex-grow: 1;
            line-height: 1.6;
        }

        .comparison-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: auto;
            padding-top: 1rem;
            border-top: 1px solid var(--gray-200);
        }

        .comparison-date {
            color: var(--gray-600);
            font-size: 0.9rem;
        }

        .read-comparison-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 0.6rem 1.2rem;
            border-radius: var(--radius);
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            text-decoration: none;
            text-align: center;
            display: inline-block;
            font-size: 0.85rem;
        }

        .read-comparison-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }

        /* No Results */
        .no-results {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--gray-600);
            grid-column: 1 / -1;
        }

        .no-results-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        /* Footer */
        footer {
            background: var(--gray-900);
            color: var(--gray-200);
            padding: 3rem 0;
            text-align: center;
        }

        .footer-content {
            max-width: 600px;
            margin: 0 auto;
        }

        .footer-links {
            display: flex;
            justify-content: center;
            gap: 2rem;
            margin: 2rem 0;
        }

        .footer-links a {
            color: var(--gray-400);
            text-decoration: none;
            transition: var(--transition);
        }

        .footer-links a:hover {
            color: var(--white);
        }

        .copyright {
            margin-top: 2rem;
            color: var(--gray-500);
            font-size: 0.9rem;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
            .navbar {
                flex-direction: column;
                gap: 1rem;
            }

            .nav-links {
                gap: 1rem;
            }

            .hero h1 {
                font-size: 2.5rem;
            }

            .hero p {
                font-size: 1.1rem;
            }

            .comparisons-grid {
                grid-template-columns: 1fr;
            }

            .section-title {
                font-size: 2rem;
            }

            .stats-bar {
                gap: 1rem;
            }

            .stat-item {
                padding: 0.8rem 1.5rem;
            }

            .stat-number {
                font-size: 1.5rem;
            }
        }

        @media (max-width: 480px) {
            .comparison-products {
                flex-direction: column;
                align-items: flex-start;
                gap: 0.3rem;
            }

            .vs-separator {
                display: none;
            }
        }

        .back-to-home {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--primary);
            text-decoration: none;
            font-weight: 600;
            margin-bottom: 2rem;
            padding: 0.5rem 1rem;
            border: 1px solid var(--primary);
            border-radius: var(--radius);
            transition: var(--transition);
        }

        .back-to-home:hover {
            background: var(--primary);
            color: white;
        }
    </style>
</head>
<body>
    <!-- Header -->
    <header>
        <div class="container">
            <nav class="navbar">
                <a href="/" class="logo">
                    <span class="logo-icon">⭐</span>
                    ReviewIndex
                </a>
                <ul class="nav-links">
                    <li><a href="/">Reviews</a></li>
                    <li><a href="/comparisons" class="active">Comparisons</a></li>
                    <li><a href="https://www.youtube.com/channel/UCii1s_g9GPERU4VxXkfsNxw">YouTube</a></li>
                </ul>
            </nav>
        </div>
    </header>

    <!-- Hero Section -->
    <section class="hero">
        <div class="container">
            <h1>Product Comparisons</h1>
            <p>Side-by-side analysis to help you choose the perfect product for your needs</p>
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Search ${totalComparisons} product comparisons...">
                <button onclick="performSearch()">🔍 Search</button>
                <div class="search-suggestions" id="searchSuggestions"></div>
            </div>
        </div>
    </section>

    <!-- Main Content -->
    <main class="main-content">
        <div class="container">
            <div class="content-wrapper">
                <a href="/" class="back-to-home">← Back to Reviews</a>
                
                <h2 class="section-title">Latest Product Comparisons</h2>
                <p class="section-subtitle">Detailed side-by-side analysis to help you make informed decisions</p>
                
                <div class="stats-bar">
                    <div class="stat-item">
                        <span class="stat-number">${totalComparisons}</span>
                        <span class="stat-label">Total Comparisons</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">${latestComparisons.length}</span>
                        <span class="stat-label">Latest Added</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-number">24-48h</span>
                        <span class="stat-label">Update Frequency</span>
                    </div>
                </div>
                
                <!-- Comparisons Grid - Server-side rendered -->
                <div class="comparisons-grid" id="comparisonsGrid">
                    ${latestComparisons.map(comp => `
                        <div class="comparison-card">
                            <img src="${escapeHtml(comp.image)}" alt="${escapeHtml(comp.title)} comparison" class="comparison-image" 
                                 onerror="this.src='${generateComparisonImage(comp.products)}'">
                            <div class="comparison-content">
                                <h3 class="comparison-title">
                                    <a href="/comparison/${escapeHtml(comp.slug)}">${escapeHtml(comp.title)}</a>
                                </h3>
                                
                                ${comp.products.length > 0 ? `
                                <div class="comparison-products">
                                    ${comp.products.map((product, index) => `
                                        <span class="product-badge">${escapeHtml(product)}</span>
                                        ${index < comp.products.length - 1 ? '<span class="vs-separator">vs</span>' : ''}
                                    `).join('')}
                                </div>
                                ` : ''}
                                
                                <p class="comparison-excerpt">${escapeHtml(comp.description)}</p>
                                <div class="comparison-meta">
                                    <span class="comparison-date">${escapeHtml(formatDate(comp.date))}</span>
                                    <a href="/comparison/${escapeHtml(comp.slug)}" class="read-comparison-btn">
                                        Compare Products
                                    </a>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                    
                    ${latestComparisons.length === 0 ? `
                    <div class="no-results">
                        <div class="no-results-icon">🔍</div>
                        <h3>No Comparisons Available Yet</h3>
                        <p>We're working on creating comprehensive product comparisons. Check back soon!</p>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
    </main>

    <!-- Footer -->
    <footer>
        <div class="container">
            <div class="footer-content">
                <h3>ReviewIndex Comparisons</h3>
                <p>Your trusted source for side-by-side product analysis</p>
                <div class="footer-links">
                    <a href="/">Single Reviews</a>
                    <a href="#privacy">Privacy Policy</a>
                    <a href="#contact">Contact</a>
                </div>
                <div class="copyright">
                    &copy; 2024 ReviewIndex. All rights reserved.
                </div>
            </div>
        </div>
    </footer>

    <script>
        const allComparisonNames = ${JSON.stringify(allComparisonNames)};
        const latestComparisons = ${JSON.stringify(latestComparisons)};
        
        function performSearch() {
            const query = document.getElementById('searchInput').value.trim().toLowerCase();
            if (!query) {
                displayLatestComparisons();
                return;
            }
            
            const filteredComparisons = allComparisonNames.filter(comp => 
                comp.title.toLowerCase().includes(query) || 
                comp.slug.toLowerCase().includes(query)
            );
            
            displaySearchResults(filteredComparisons, query);
        }
        
        function displaySearchResults(results, query) {
            const comparisonsGrid = document.getElementById('comparisonsGrid');
            
            if (results.length === 0) {
                comparisonsGrid.innerHTML = \`
                    <div class="no-results" style="grid-column: 1 / -1;">
                        <div class="no-results-icon">🔍</div>
                        <h3>No comparisons found for "\${query}"</h3>
                        <p>We couldn't find any comparisons matching your search.</p>
                        <p>Try searching for individual product reviews or check back later for new comparisons.</p>
                    </div>
                \`;
            } else {
                comparisonsGrid.innerHTML = results.map(comp => {
                    // Find the full comparison data or use fallback
                    const fullComp = latestComparisons.find(c => c.slug === comp.slug) || comp;
                    return \`
                        <div class="comparison-card">
                            <div class="comparison-content">
                                <h3 class="comparison-title">
                                    <a href="/comparison/\${comp.slug}">\${highlightText(comp.title, query)}</a>
                                </h3>
                                <p class="comparison-excerpt">Detailed side-by-side comparison and analysis</p>
                                <div class="comparison-meta">
                                    <span class="comparison-date">Comparison</span>
                                    <a href="/comparison/\${comp.slug}" class="read-comparison-btn">
                                        View Comparison
                                    </a>
                                </div>
                            </div>
                        </div>
                    \`;
                }).join('');
            }
        }
        
        function displayLatestComparisons() {
            const comparisonsGrid = document.getElementById('comparisonsGrid');
            comparisonsGrid.innerHTML = latestComparisons.map(comp => \`
                <div class="comparison-card">
                    <img src="\${comp.image}" alt="\${comp.title} comparison" class="comparison-image" 
                         onerror="this.src='\${generateComparisonImage(comp.products)}'">
                    <div class="comparison-content">
                        <h3 class="comparison-title">
                            <a href="/comparison/\${comp.slug}">\${comp.title}</a>
                        </h3>
                        \${comp.products.length > 0 ? \`
                        <div class="comparison-products">
                            \${comp.products.map((product, index) => \`
                                <span class="product-badge">\${product}</span>
                                \${index < comp.products.length - 1 ? '<span class="vs-separator">vs</span>' : ''}
                            \`).join('')}
                        </div>
                        \` : ''}
                        <p class="comparison-excerpt">\${comp.description}</p>
                        <div class="comparison-meta">
                            <span class="comparison-date">\${comp.date}</span>
                            <a href="/comparison/\${comp.slug}" class="read-comparison-btn">
                                Compare Products
                            </a>
                        </div>
                    </div>
                </div>
            \`).join('');
        }
        
        function highlightText(text, query) {
            if (!query) return text;
            const regex = new RegExp(\`(\${query})\`, 'gi');
            return text.replace(regex, '<mark style="background: yellow;">$1</mark>');
        }

        // Search suggestions
        document.getElementById('searchInput').addEventListener('input', function(e) {
            const query = e.target.value.toLowerCase();
            const suggestions = document.getElementById('searchSuggestions');
            
            if (query.length < 2) {
                suggestions.style.display = 'none';
                return;
            }
            
            const matchedComparisons = allComparisonNames.filter(comp => 
                comp.title.toLowerCase().includes(query) || 
                comp.slug.toLowerCase().includes(query)
            ).slice(0, 5);
            
            if (matchedComparisons.length > 0) {
                suggestions.innerHTML = matchedComparisons.map(comp => \`
                    <div class="suggestion-item" onclick="document.getElementById('searchInput').value='\${comp.title}'; performSearch();">
                        \${comp.title}
                    </div>
                \`).join('');
                suggestions.style.display = 'block';
            } else {
                suggestions.style.display = 'none';
            }
        });
        
        // Hide suggestions when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.search-box')) {
                document.getElementById('searchSuggestions').style.display = 'none';
            }
        });

        // Enter key support
        document.getElementById('searchInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') performSearch();
        });
    </script>
</body>
</html>`;
}

// Helper functions
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

function formatComparisonSlug(slug) {
    return slug.split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .replace(/ Vs /g, ' vs ');
}

function generateComparisonImage(products) {
    if (products && products.length > 0) {
        const productNames = products.join('-vs-');
        return `https://via.placeholder.com/400x220/3b82f6/ffffff?text=${encodeURIComponent(productNames)}`;
    }
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIyMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzljYTViOCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPlByb2R1Y3QgQ29tcGFyaXNvbjwvdGV4dD48L3N2Zz4=';
}

function formatDate(dateString) {
    if (dateString === 'Recent') return dateString;
    try {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch {
        return dateString;
    }
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

function renderErrorPage() {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <title>Error - ReviewIndex Comparisons</title>
    <meta name="robots" content="noindex">
    <style>
        body { font-family: system-ui; text-align: center; padding: 4rem; background: #f5f5f5; }
        .error-container { background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #dc2626; margin-bottom: 1rem; }
        a { color: #2563eb; text-decoration: none; }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>⚠️ Server Error</h1>
        <p>An error occurred while loading the comparisons page. Please try again later.</p>
        <p><a href="/comparisons">← Return to Comparisons</a></p>
    </div>
</body>
</html>`;
    
    return new Response(html, { 
        status: 500,
        headers: { 'Content-Type': 'text/html' }
    });
}
