// functions/index.js
export async function onRequest(context) {
    const { request, env } = context;
    
    // Handle POST requests for review submissions
    if (request.method === 'POST') {
        return await handleReviewRequest(context);
    }
    
    // Handle GET requests for homepage
    const cacheKey = new Request(request.url, request);
    const cache = caches.default;
    
    // Try to get from cache first (3 hours cache)
    let response = await cache.match(cacheKey);
    if (response) {
        console.log('✅ INDEX Cache HIT - Serving from cache');
        return response;
    }
    console.log('🔄 INDEX Cache MISS - fetching fresh data');
    
    try {
        // SINGLE API CALL - Get only 10 latest posts from GitHub
        const latestPosts = await fetchLatestPosts(env.GITHUB_TOKEN);
        
        // Get all post names for search (from cache or minimal call)
        const allPostNames = await getAllPostNames(env.GITHUB_TOKEN);
        
        // Generate the complete HTML with full SEO
        const html = generateIndexHTML(latestPosts, allPostNames);
        
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
        console.log('✅ Fresh data fetched and cached for 3 hours');
        return response;

    } catch (error) {
        console.error('Error generating index page:', error);
        return renderErrorPage();
    }
}

// Handle review request submissions
async function handleReviewRequest(context) {
    const { request, env } = context;
    
    try {
        const formData = await request.formData();
        const productName = formData.get('productName');
        const email = formData.get('email');
        const additionalInfo = formData.get('additionalInfo');
        
        if (!productName || !email) {
            return new Response(JSON.stringify({ success: false, error: 'Product name and email are required' }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Create markdown content for the review request
        const content = `---
product: "${productName.replace(/"/g, '')}"
email: "${email}"
status: "pending"
date: "${new Date().toISOString()}"
submitted_via: "website_form"
---

# Review Request: ${productName}

**Email:** ${email}
**Request Date:** ${new Date().toLocaleDateString()}
**Status:** ⏳ Pending Review

## Additional Information:
${additionalInfo || 'No additional information provided.'}

---

*This review request was submitted through the website form.*
`;
        
        // Create filename from product name
        const slug = productName.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        const filename = `review-request-${slug}-${Date.now()}.md`;
        
        // Write to GitHub repository
        const result = await createReviewRequestInGitHub(env.GITHUB_TOKEN, filename, content);
        
        if (result.success) {
            return new Response(JSON.stringify({ 
                success: true, 
                message: 'Thank you! Your review request has been submitted successfully. We typically publish reviews within 24-48 hours. You\'ll receive an email notification when your requested review is live!' 
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            throw new Error(result.error);
        }
        
    } catch (error) {
        console.error('Error handling review request:', error);
        return new Response(JSON.stringify({ 
            success: false, 
            error: 'We encountered an issue submitting your request. Please try again in a few moments or contact us directly.' 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Create review request in GitHub
async function createReviewRequestInGitHub(githubToken, filename, content) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/review-requests/${filename}`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'ReviewIndex-App',
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Review request: ${filename}`,
                    content: btoa(unescape(encodeURIComponent(content))),
                    branch: 'main'
                })
            }
        );

        if (response.ok) {
            return { success: true };
        } else {
            const errorData = await response.json();
            return { success: false, error: errorData.message || 'GitHub API error' };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Fetch only 10 latest posts with full content
async function fetchLatestPosts(githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    
    try {
        console.log('📡 Fetching 10 latest posts...');
        
        // Get list of files in reviews directory
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/reviews`,
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
        
        // Take only latest 10 files
        const latestFiles = files
            .filter(file => file.name.endsWith('.md'))
            .slice(0, 10);

        const posts = [];
        
        // Fetch content for only these 10 posts
        for (const file of latestFiles) {
            try {
                const postResponse = await fetch(file.download_url, {
                    headers: {
                        'Authorization': `token ${githubToken}`,
                        'User-Agent': 'ReviewIndex-App'
                    }
                });
                
                if (postResponse.ok) {
                    const content = await postResponse.text();
                    const { frontmatter } = parseMarkdown(content);
                    
                    posts.push({
                        slug: file.name.replace('.md', ''),
                        title: frontmatter.title || formatSlug(file.name.replace('.md', '')),
                        description: frontmatter.description || 'Comprehensive product review and analysis',
                        rating: parseInt(frontmatter.rating) || 4,
                        date: frontmatter.date || 'Recent',
                        image: frontmatter.image || getPlaceholderImage(),
                        categories: frontmatter.categories || ['general']
                    });
                }
            } catch (error) {
                console.error(`Error processing file ${file.name}:`, error);
                // Fallback with basic info
                posts.push({
                    slug: file.name.replace('.md', ''),
                    title: formatSlug(file.name.replace('.md', '')),
                    description: 'Comprehensive product review and analysis',
                    rating: 4,
                    date: 'Recent',
                    image: getPlaceholderImage(),
                    categories: ['general']
                });
            }
        }
        
        console.log(`✅ Processed ${posts.length} latest posts`);
        return posts;

    } catch (error) {
        console.error('❌ Error fetching latest posts:', error);
        return [];
    }
}

// Get all post names for search (minimal API call)
async function getAllPostNames(githubToken) {
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
        
        // Extract just the post names and slugs
        const postNames = treeData.tree
            .filter(item => 
                item.type === 'blob' &&
                item.path.startsWith('content/reviews/') && 
                item.path.endsWith('.md')
            )
            .map(file => {
                const filename = file.path.split('/').pop().replace('.md', '');
                return {
                    slug: filename,
                    title: formatSlug(filename)
                };
            })
            .sort((a, b) => b.slug.localeCompare(a.slug));

        console.log(`✅ Found ${postNames.length} post names for search`);
        return postNames;

    } catch (error) {
        console.error('Error fetching post names:', error);
        return [];
    }
}

function generateIndexHTML(latestPosts, allPostNames) {
    const totalPosts = allPostNames.length;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ReviewIndex - Honest Product Reviews & Ratings</title>
    <meta name="description" content="Unbiased product reviews, expert ratings, and buying guides. Find the best products with our comprehensive testing and analysis.">
    <meta name="keywords" content="product reviews, buying guides, product ratings, best products, honest reviews">
    <meta name="author" content="ReviewIndex">
    
    <!-- Essential SEO Meta Tags -->
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
    <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    <meta name="bingbot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
    <meta name="slurp" content="index, follow">
    <meta name="duckduckbot" content="index, follow">
    <meta name="yandex" content="index, follow">
    <meta name="baiduspider" content="index, follow">

    <!-- Canonical URL -->
    <link rel="canonical" href="https://reviewindex.pages.dev/">
    <link rel="icon" type="image/png" href="icon.png">

    <!-- Sitemap Reference -->
    <link rel="sitemap" type="application/xml" href="/sitemap.xml">

    <!-- Additional Search Engine Directives -->
    <meta name="author" content="ReviewIndex">
    <meta name="language" content="en-US">
    <meta name="rating" content="General">
    <meta name="distribution" content="Global">
    <meta name="revisit-after" content="7 days">
    <meta name="generator" content="ReviewIndex">

    <!-- Mobile Optimization -->
    <meta name="theme-color" content="#2563eb">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">

    <!-- Geo Tags -->
    <meta name="geo.region" content="US">
    <meta name="geo.placename" content="Internet">
    <meta name="geo.position" content="0;0">
    <meta name="ICBM" content="0, 0">
    
    <!-- Open Graph / Social Media -->
    <meta property="og:title" content="ReviewIndex - Honest Product Reviews & Ratings">
    <meta property="og:description" content="Unbiased product reviews, expert ratings, and buying guides.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://reviewindex.pages.dev">
    <meta property="og:image" content="https://reviewindex.pages.dev/og-image.jpg">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="ReviewIndex - Honest Product Reviews">
    <meta name="twitter:description" content="Unbiased product reviews and buying guides">
    
    <!-- Schema.org Structured Data -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "ReviewIndex",
        "url": "https://reviewindex.pages.dev",
        "description": "Unbiased product reviews, expert ratings, and buying guides",
        "publisher": {
            "@type": "Organization",
            "name": "ReviewIndex",
            "logo": {
                "@type": "ImageObject",
                "url": "https://reviewindex.pages.dev/logo.png"
            }
        },
        "potentialAction": {
            "@type": "SearchAction",
            "target": "https://reviewindex.pages.dev/search?q={search_term_string}",
            "query-input": "required name=search_term_string"
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
            --radius: 8px;
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
            font-size: 2.2rem;
            text-align: center;
            margin-bottom: 3rem;
            color: var(--gray-900);
        }

        .section-subtitle {
            text-align: center;
            color: var(--gray-600);
            margin-bottom: 2rem;
            font-size: 1.1rem;
        }

        /* Posts Grid */
        .posts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }

        .post-card {
            background: var(--white);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            transition: var(--transition);
            overflow: hidden;
            border: 1px solid var(--gray-200);
            display: flex;
            flex-direction: column;
        }

        .post-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-lg);
        }

        .post-image {
            width: 100%;
            height: 200px;
            object-fit: cover;
            background: linear-gradient(45deg, var(--gray-100), var(--gray-200));
        }

        .post-content {
            padding: 1.5rem;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
        }

        .post-title {
            font-size: 1.3rem;
            font-weight: 600;
            margin-bottom: 0.5rem;
            line-height: 1.4;
        }

        .post-title a {
            color: var(--gray-900);
            text-decoration: none;
            transition: var(--transition);
        }

        .post-title a:hover {
            color: var(--primary);
        }

        .post-excerpt {
            color: var(--gray-600);
            margin-bottom: 1rem;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            flex-grow: 1;
        }

        .post-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: auto;
            padding-top: 1rem;
            border-top: 1px solid var(--gray-200);
        }

        .post-rating {
            display: flex;
            align-items: center;
            gap: 0.3rem;
            color: var(--secondary);
            font-weight: 600;
        }

        .post-date {
            color: var(--gray-600);
            font-size: 0.9rem;
        }

        .read-review-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
            font-weight: 600;
            cursor: pointer;
            transition: var(--transition);
            text-decoration: none;
            text-align: center;
            display: inline-block;
            font-size: 0.8rem;
            margin-top: 0.5rem;
        }

        .read-review-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-1px);
        }

        /* Review Request Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 10000;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background: white;
            padding: 2rem;
            border-radius: var(--radius);
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
        }

        .modal h3 {
            margin-bottom: 1rem;
            color: var(--gray-900);
        }

        .form-group {
            margin-bottom: 1rem;
        }

        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
        }

        .form-group input,
        .form-group textarea {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid var(--gray-300);
            border-radius: var(--radius);
            font-size: 1rem;
        }

        .form-group textarea {
            height: 100px;
            resize: vertical;
        }

        .submit-btn {
            background: var(--primary);
            color: white;
            border: none;
            padding: 0.75rem 1.5rem;
            border-radius: var(--radius);
            font-weight: 600;
            cursor: pointer;
            width: 100%;
        }

        .submit-btn:hover {
            background: var(--primary-dark);
        }

        .submit-btn:disabled {
            background: var(--gray-400);
            cursor: not-allowed;
        }

        .close-modal {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            float: right;
            color: var(--gray-600);
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

            .posts-grid {
                grid-template-columns: 1fr;
            }

            .section-title {
                font-size: 1.8rem;
            }
        }

        .no-posts {
            text-align: center;
            padding: 4rem 2rem;
            color: var(--gray-600);
            grid-column: 1 / -1;
        }

        .no-posts-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        .hidden {
            display: none;
        }

        .view-all-btn {
            background: var(--gray-200);
            color: var(--gray-700);
            border: none;
            padding: 0.8rem 1.5rem;
            border-radius: var(--radius);
            cursor: pointer;
            transition: var(--transition);
            font-weight: 500;
            margin: 2rem auto;
            display: block;
        }

        .view-all-btn:hover {
            background: var(--gray-300);
        }

        .ask-review-btn {
            background: var(--success);
            color: white;
            border: none;
            padding: 0.8rem 1.5rem;
            border-radius: var(--radius);
            cursor: pointer;
            font-weight: 600;
            margin-top: 1rem;
        }

        .ask-review-btn:hover {
            background: #0da271;
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
                    <li><a href="#reviews">Reviews</a></li>
                    <li><a href="#categories">Categories</a></li>
                    <li><a href="https://www.youtube.com/channel/UCii1s_g9GPERU4VxXkfsNxw">YouTube</a></li>
                </ul>
            </nav>
        </div>
    </header>

    <!-- Hero Section -->
    <section class="hero">
        <div class="container">
            <h1>Honest Product Reviews You Can Trust</h1>
            <p>Unbiased testing, expert analysis, and real-world results to help you make better buying decisions</p>
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Search ${totalPosts} product reviews...">
                <button onclick="performSearch()">🔍 Search</button>
                <div class="search-suggestions" id="searchSuggestions"></div>
            </div>
        </div>
    </section>

    <!-- Main Content -->
    <main class="main-content">
        <div class="container">
            <div class="content-wrapper">
                <h2 class="section-title" id="reviews">Latest Reviews</h2>
                <p class="section-subtitle">Showing 10 most recent reviews • ${totalPosts} total reviews available</p>
                
                <!-- Posts Grid - Server-side rendered -->
                <div class="posts-grid" id="postsGrid">
                    ${latestPosts.map(post => `
                        <div class="post-card">
                            <img src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" class="post-image" 
                                 onerror="this.src='${getPlaceholderImage()}'">
                            <div class="post-content">
                                <h3 class="post-title">
                                    <a href="/review/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a>
                                </h3>
                                <p class="post-excerpt">${escapeHtml(post.description)}</p>
                                <div class="post-meta">
                                    <div class="post-rating">
                                        ${'⭐'.repeat(post.rating)} ${post.rating}/5
                                    </div>
                                    <span class="post-date">${escapeHtml(formatDate(post.date))}</span>
                                </div>
                                <a href="/review/${escapeHtml(post.slug)}" class="read-review-btn">Read Review</a>
                            </div>
                        </div>
                    `).join('')}
                </div>

                <button class="ask-review-btn" onclick="showReviewModal()">
                    📝 Request a Product Review
                </button>
            </div>
        </div>
    </main>

    <!-- Review Request Modal -->
    <div class="modal" id="reviewModal">
        <div class="modal-content">
            <button class="close-modal" onclick="closeReviewModal()">&times;</button>
            <h3>Request a Product Review</h3>
            <p>Can't find the review you're looking for? Let us know what product you'd like us to review!</p>
            <form id="reviewRequestForm">
                <div class="form-group">
                    <label for="productName">Product Name *</label>
                    <input type="text" id="productName" name="productName" required 
                           placeholder="e.g., iPhone 15 Pro, Samsung Galaxy S24">
                </div>
                <div class="form-group">
                    <label for="email">Your Email *</label>
                    <input type="email" id="email" name="email" required 
                           placeholder="you@example.com">
                </div>
                <div class="form-group">
                    <label for="additionalInfo">Additional Information (Optional)</label>
                    <textarea id="additionalInfo" name="additionalInfo" 
                              placeholder="Any specific features you want us to test? Or particular concerns about this product?"></textarea>
                </div>
                <button type="submit" class="submit-btn" id="submitBtn">
                    Submit Review Request
                </button>
            </form>
            <p style="margin-top: 1rem; font-size: 0.9rem; color: var(--gray-600);">
                We typically publish requested reviews within 24-48 hours. You'll receive an email notification when your review is live!
            </p>
        </div>
    </div>

    <!-- Footer -->
    <footer>
        <div class="container">
            <div class="footer-content">
                <h3>ReviewIndex</h3>
                <p>Your trusted source for honest product reviews and buying advice</p>
                <div class="footer-links">
                    <a href="#privacy">Privacy Policy</a>
                    <a href="#terms">Terms of Service</a>
                    <a href="#about">About Us</a>
                    <a href="#contact">Contact</a>
                </div>
                <div class="copyright">
                    &copy; 2024 ReviewIndex. All rights reserved.
                </div>
            </div>
        </div>
    </footer>

    <script>
        const allPostNames = ${JSON.stringify(allPostNames)};
        const latestPosts = ${JSON.stringify(latestPosts)};
        
        function performSearch() {
            const query = document.getElementById('searchInput').value.trim().toLowerCase();
            if (!query) {
                displayLatestPosts();
                return;
            }
            
            const filteredPosts = allPostNames.filter(post => 
                post.title.toLowerCase().includes(query) || 
                post.slug.toLowerCase().includes(query)
            );
            
            displaySearchResults(filteredPosts, query);
        }
        
        function displaySearchResults(results, query) {
            const postsGrid = document.getElementById('postsGrid');
            
            if (results.length === 0) {
                postsGrid.innerHTML = \`
                    <div class="no-posts" style="grid-column: 1 / -1;">
                        <div class="no-posts-icon">🔍</div>
                        <h3>No reviews found for "\${query}"</h3>
                        <p>We couldn't find any reviews matching your search.</p>
                        <p><strong>Want us to review this product?</strong></p>
                        <button class="ask-review-btn" onclick="showReviewModal()">📝 Request a Review</button>
                    </div>
                \`;
            } else {
                postsGrid.innerHTML = results.map(post => \`
                    <div class="post-card">
                        <div class="post-content">
                            <h3 class="post-title">
                                <a href="/review/\${post.slug}">\${highlightText(post.title, query)}</a>
                            </h3>
                            <p class="post-excerpt">Click to read our comprehensive review of this product</p>
                            <div class="post-meta">
                                <div class="post-rating">
                                    ⭐⭐⭐⭐⭐
                                </div>
                                <a href="/review/\${post.slug}" class="read-review-btn">Read Full Review</a>
                            </div>
                        </div>
                    </div>
                \`).join('');
            }
        }
        
        function displayLatestPosts() {
            const postsGrid = document.getElementById('postsGrid');
            postsGrid.innerHTML = latestPosts.map(post => \`
                <div class="post-card">
                    <img src="\${post.image}" alt="\${post.title}" class="post-image" 
                         onerror="this.src='\${getPlaceholderImage()}'">
                    <div class="post-content">
                        <h3 class="post-title">
                            <a href="/review/\${post.slug}">\${post.title}</a>
                        </h3>
                        <p class="post-excerpt">\${post.description}</p>
                        <div class="post-meta">
                            <div class="post-rating">
                                \${'⭐'.repeat(post.rating)} \${post.rating}/5
                            </div>
                            <span class="post-date">\${post.date}</span>
                        </div>
                        <a href="/review/\${post.slug}" class="read-review-btn">Read Review</a>
                    </div>
                </div>
            \`).join('');
        }
        
        function highlightText(text, query) {
            if (!query) return text;
            const regex = new RegExp(\`(\${query})\`, 'gi');
            return text.replace(regex, '<mark style="background: yellow;">$1</mark>');
        }
        
        function getPlaceholderImage() {
            return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzljYTViOCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPlJldmlldyBJbWFnZTwvdGV4dD48L3N2Zz4=';
        }

        // Review Request Modal Functions
        function showReviewModal() {
            document.getElementById('reviewModal').style.display = 'flex';
        }

        function closeReviewModal() {
            document.getElementById('reviewModal').style.display = 'none';
        }

        // Handle form submission
        document.getElementById('reviewRequestForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const submitBtn = document.getElementById('submitBtn');
            const originalText = submitBtn.textContent;
            
            submitBtn.textContent = 'Submitting...';
            submitBtn.disabled = true;
            
            try {
                const formData = new FormData(this);
                const response = await fetch('/', {
                    method: 'POST',
                    body: formData
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ ' + result.message);
                    closeReviewModal();
                    this.reset();
                } else {
                    alert('❌ ' + result.error);
                }
            } catch (error) {
                alert('❌ Network error. Please try again.');
            } finally {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        });

        // Search suggestions
        document.getElementById('searchInput').addEventListener('input', function(e) {
            const query = e.target.value.toLowerCase();
            const suggestions = document.getElementById('searchSuggestions');
            
            if (query.length < 2) {
                suggestions.style.display = 'none';
                return;
            }
            
            const matchedPosts = allPostNames.filter(post => 
                post.title.toLowerCase().includes(query) || 
                post.slug.toLowerCase().includes(query)
            ).slice(0, 5);
            
            if (matchedPosts.length > 0) {
                suggestions.innerHTML = matchedPosts.map(post => \`
                    <div class="suggestion-item" onclick="document.getElementById('searchInput').value='\${post.title}'; performSearch();">
                        \${post.title}
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

        // Close modal when clicking outside
        document.getElementById('reviewModal').addEventListener('click', function(e) {
            if (e.target === this) closeReviewModal();
        });
    </script>
</body>
</html>`;
}

// Helper functions
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

function formatSlug(slug) {
    return slug.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
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

function getPlaceholderImage() {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzljYTViOCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPlJldmlldyBJbWFnZTwvdGV4dD48L3N2Zz4=';
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
    <title>Error - ReviewIndex</title>
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
        <p>An error occurred while loading the homepage. Please try again later.</p>
        <p><a href="/">← Return to Homepage</a></p>
    </div>
</body>
</html>`;
    
    return new Response(html, { 
        status: 500,
        headers: { 'Content-Type': 'text/html' }
    });
    }
