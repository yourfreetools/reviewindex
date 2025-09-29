// functions/comparisons.js
export async function onRequest(context) {
    const { request, env } = context;
    
    try {
        // Get URL parameters for search
        const url = new URL(request.url);
        const searchQuery = url.searchParams.get('search') || '';
        
        // Fetch only comparison file names (lightweight API call)
        const comparisonList = await fetchComparisonList(env.GITHUB_TOKEN);
        
        if (!comparisonList || comparisonList.length === 0) {
            return renderErrorPage('No comparisons found', 'There are no product comparisons available at the moment.');
        }

        // Filter comparisons based on search (client-side, no extra API calls)
        let searchResults = [];
        let showingResults = false;
        
        if (searchQuery.trim()) {
            searchResults = filterComparisonsBySearch(comparisonList, searchQuery);
            showingResults = true;
        }

        // Get search suggestions based on all available comparisons
        const searchSuggestions = generateSearchSuggestions(comparisonList);

        // Render the comparisons listing page
        const htmlContent = renderComparisonsPage(
            searchResults,
            comparisonList.slice(0, 6), // Show first 6 as "featured"
            searchSuggestions,
            {
                searchQuery,
                showingResults,
                totalResults: searchResults.length,
                totalComparisons: comparisonList.length
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

async function fetchComparisonList(githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const CACHE_KEY = 'comparisons-list';
    
    try {
        // Try to get from cache first
        const cache = caches.default;
        const cacheUrl = new URL(`https://cache.reviewindex.pages.dev/${CACHE_KEY}`);
        let cachedResponse = await cache.match(cacheUrl);
        
        if (cachedResponse) {
            return await cachedResponse.json();
        }
        
        // Fetch only the file list (lightweight API call)
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
            const comparisons = [];
            
            // Process only file names - no content downloading
            for (const file of files) {
                if (file.name.endsWith('.md')) {
                    const slug = file.name.replace('.md', '');
                    const title = formatSlugToTitle(slug);
                    
                    // Extract products from slug for better search
                    const products = extractProductsFromSlug(slug);
                    
                    comparisons.push({
                        slug: slug,
                        title: title,
                        products: products,
                        categories: ['comparisons'], // Default category
                        date: file.last_modified || new Date().toISOString(),
                        // No description or image to avoid API calls
                    });
                }
            }
            
            // Store in cache for 3 hours
            const cacheResponse = new Response(JSON.stringify(comparisons), {
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=10800'
                }
            });
            
            await cache.put(cacheUrl, cacheResponse.clone());
            
            return comparisons;
        }
        return [];
    } catch (error) {
        console.error('Error fetching comparison list:', error);
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
        
        // Search in product names
        if (comp.products.some(product => product.toLowerCase().includes(query))) return true;
        
        return false;
    }).slice(0, 20); // Limit results for performance
}

function generateSearchSuggestions(comparisons) {
    const suggestions = new Set();
    
    // Extract popular product names and categories
    comparisons.forEach(comp => {
        comp.products.forEach(product => {
            // Add individual product suggestions
            const words = product.split(' ');
            if (words.length > 0) {
                suggestions.add(words[0]); // Brand name
            }
            suggestions.add(product);
        });
        
        // Add comparison suggestions
        if (comp.products.length >= 2) {
            suggestions.add(`${comp.products[0]} vs ${comp.products[1]}`);
        }
    });
    
    // Add common comparison types
    suggestions.add('iPhone vs Samsung');
    suggestions.add('MacBook vs Windows');
    suggestions.add('Gaming Headphones');
    suggestions.add('Smartphone Camera');
    suggestions.add('Laptop Battery Life');
    suggestions.add('Budget Phones');
    
    return Array.from(suggestions).slice(0, 15); // Limit to 15 suggestions
}

function renderComparisonsPage(searchResults, featuredComparisons, searchSuggestions, filters, requestUrl) {
    const canonicalUrl = `https://reviewindex.pages.dev/comparisons`;
    const searchTitle = filters.searchQuery ? `Search Results for "${filters.searchQuery}"` : 'Product Comparisons';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(searchTitle)} - Find Product Comparisons | ReviewIndex</title>
    <meta name="description" content="Search and find detailed product comparisons. Compare specs, prices, features and make informed buying decisions.">
    <link rel="canonical" href="${canonicalUrl}">
    
    <!-- SEO Meta Tags -->
    <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    <meta name="keywords" content="product comparisons, compare products, buying guide, vs, review comparison">
    
    <!-- Open Graph -->
    <meta property="og:title" content="${escapeHtml(searchTitle)} - ReviewIndex">
    <meta property="og:description" content="Search and find detailed product comparisons. Compare specs, prices, features and make informed buying decisions.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${canonicalUrl}">
    <meta property="og:image" content="https://reviewindex.pages.dev/images/comparisons-og.jpg">
    <meta property="og:site_name" content="ReviewIndex">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(searchTitle)} - ReviewIndex">
    <meta name="twitter:description" content="Search and find detailed product comparisons. Compare specs, prices, features and make informed buying decisions.">
    <meta name="twitter:image" content="https://reviewindex.pages.dev/images/comparisons-og.jpg">
    
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
            border-radius: 16px;
            box-shadow: var(--shadow);
            margin: 2rem 0;
            border: 1px solid var(--border);
        }
        
        .search-form {
            max-width: 600px;
            margin: 0 auto;
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
            border-radius: 12px;
            font-size: 1.1rem;
            transition: all 0.3s ease;
        }
        
        .search-input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .search-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 1rem 2rem;
            border-radius: 12px;
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
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            justify-content: center;
            margin-top: 1.5rem;
        }
        
        .suggestion-chip {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            cursor: pointer;
            transition: all 0.3s ease;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        
        .suggestion-chip:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }
        
        /* Results Section */
        .results-section {
            background: white;
            padding: 2.5rem;
            border-radius: 16px;
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
            border-radius: 16px;
            padding: 2rem;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            transition: all 0.3s ease;
            text-decoration: none;
            color: inherit;
            display: block;
        }
        
        .comparison-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        
        .card-title {
            font-size: 1.3rem;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 1rem;
            line-height: 1.4;
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
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 500;
        }
        
        .vs-text {
            color: #94a3b8;
            font-weight: 600;
            font-size: 0.9rem;
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
            border-radius: 16px;
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
            
            .search-suggestions {
                justify-content: flex-start;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Main Header -->
        <header class="header" role="banner">
            <h1>🔍 Find Product Comparisons</h1>
            <p class="description">Search and compare products side-by-side. Make informed buying decisions with detailed comparisons.</p>
            
            <!-- Search Form -->
            <div class="search-form">
                <form action="/comparisons" method="GET" role="search">
                    <div class="search-input-group">
                        <input 
                            type="text" 
                            name="search" 
                            class="search-input" 
                            placeholder="Search for product comparisons (e.g., iPhone vs Samsung, Laptop comparison...)" 
                            value="${escapeHtml(filters.searchQuery)}"
                            aria-label="Search product comparisons"
                            id="searchInput"
                        >
                        <button type="submit" class="search-btn">Search</button>
                    </div>
                </form>
                
                <!-- Search Suggestions -->
                ${searchSuggestions.length > 0 ? `
                <div class="search-suggestions">
                    ${searchSuggestions.map(suggestion => `
                        <div class="suggestion-chip" onclick="setSearchQuery('${escapeHtml(suggestion)}')">
                            ${escapeHtml(suggestion)}
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        </header>
        
        <!-- Search Results -->
        ${filters.showingResults ? `
        <div class="results-section">
            <div class="results-header">
                <h2>Search Results for "${escapeHtml(filters.searchQuery)}"</h2>
                <div class="results-count">${filters.totalResults} comparison${filters.totalResults !== 1 ? 's' : ''} found</div>
            </div>
            
            ${filters.totalResults > 0 ? `
            <div class="comparisons-grid">
                ${searchResults.map(comp => `
                    <a href="/comparison/${comp.slug}" class="comparison-card" aria-label="View comparison: ${escapeHtml(comp.title)}">
                        <h3 class="card-title">${escapeHtml(comp.title)}</h3>
                        ${comp.products.length > 0 ? `
                        <div class="card-products">
                            ${comp.products.map((product, index) => `
                                <span class="product-badge">${escapeHtml(product)}</span>
                                ${index < comp.products.length - 1 ? '<span class="vs-text">vs</span>' : ''}
                            `).join('')}
                        </div>
                        ` : ''}
                        <div class="card-meta">
                            <span>Click to view detailed comparison</span>
                        </div>
                    </a>
                `).join('')}
            </div>
            ` : `
            <div class="no-results">
                <h3>No comparisons found for "${escapeHtml(filters.searchQuery)}"</h3>
                <p>Try searching with different keywords or check the suggestions above.</p>
            </div>
            `}
        </div>
        ` : ''}
        
        <!-- Featured Comparisons -->
        <section class="featured-section" aria-labelledby="featured-title">
            <h2 class="section-title" id="featured-title">📈 Available Comparisons</h2>
            <p style="text-align: center; color: #64748b; margin-bottom: 2rem;">
                Browse our collection of ${filters.totalComparisons} product comparisons
            </p>
            
            <div class="comparisons-grid">
                ${featuredComparisons.map(comp => `
                    <a href="/comparison/${comp.slug}" class="comparison-card" aria-label="View comparison: ${escapeHtml(comp.title)}">
                        <h3 class="card-title">${escapeHtml(comp.title)}</h3>
                        ${comp.products.length > 0 ? `
                        <div class="card-products">
                            ${comp.products.map((product, index) => `
                                <span class="product-badge">${escapeHtml(product)}</span>
                                ${index < comp.products.length - 1 ? '<span class="vs-text">vs</span>' : ''}
                            `).join('')}
                        </div>
                        ` : ''}
                        <div class="card-meta">
                            <span>Click to view detailed comparison</span>
                        </div>
                    </a>
                `).join('')}
            </div>
        </section>
        
        <footer class="footer" role="contentinfo">
            <p>© ${new Date().getFullYear()} ReviewIndex. All comparisons are independently researched.</p>
            <p>Total comparisons available: ${filters.totalComparisons}</p>
        </footer>
    </div>
    
    <script>
        // Enhanced search functionality
        function setSearchQuery(query) {
            document.getElementById('searchInput').value = query;
            document.querySelector('form[role="search"]').submit();
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('searchInput');
            const searchForm = document.querySelector('form[role="search"]');
            
            // Focus search input on page load
            if (searchInput && !searchInput.value) {
                searchInput.focus();
            }
            
            // Add real-time search suggestions (client-side)
            if (searchInput) {
                let searchTimeout;
                searchInput.addEventListener('input', function() {
                    clearTimeout(searchTimeout);
                    // Could add client-side filtering here if needed
                });
            }
            
            // Handle empty search
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
