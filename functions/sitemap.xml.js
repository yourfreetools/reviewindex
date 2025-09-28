// Date cleaning function
function cleanDate(dateString) {
    if (!dateString) return new Date().toISOString().split('T')[0];
    const cleaned = dateString.toString().replace(/["']/g, '').split('T')[0];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(cleaned)) {
        return new Date().toISOString().split('T')[0];
    }
    const today = new Date().toISOString().split('T')[0];
    return cleaned > today ? today : cleaned;
}

// Slug validation function
function generateValidSlug(rawSlug) {
    if (!rawSlug) return 'untitled';
    return rawSlug
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// XML escaping function
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Constants
const MAX_URLS_PER_SITEMAP = 50000; // Google's limit
const SITEMAP_BASE_URL = 'https://reviewindex.pages.dev';

export async function onRequestGet(context) {
    try {
        const url = new URL(context.request.url);
        const pathname = url.pathname;
        
        // Handle different sitemap requests
        if (pathname === '/sitemap.xml') {
            return await generateMainSitemap(context);
        } else if (pathname === '/sitemap-posts.xml') {
            return await generatePostsSitemap(context, 0);
        } else if (pathname.startsWith('/sitemap-posts-')) {
            const match = pathname.match(/sitemap-posts-(\d+)\.xml/);
            if (match) {
                const index = parseInt(match[1]) - 1; // Convert to 0-based index
                return await generatePostsSitemap(context, index);
            }
        }
        
        // Default to main sitemap
        return await generateMainSitemap(context);
        
    } catch (error) {
        console.error('Sitemap generation error:', error);
        return generateErrorSitemap();
    }
}

// Generate main sitemap index
async function generateMainSitemap(context) {
    const baseUrl = context.env.SITE_URL || SITEMAP_BASE_URL;
    const currentDate = new Date().toISOString();
    
    // Get all posts to calculate how many sitemaps we need
    const allPosts = await getAllPosts(context);
    const totalPostsSitemaps = Math.ceil(allPosts.length / MAX_URLS_PER_SITEMAP);
    
    let sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // Always include the main posts sitemap (sitemap-posts.xml)
    sitemapIndex += `
    <sitemap>
        <loc>${baseUrl}/sitemap-posts.xml</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
    </sitemap>`;

    // Add additional posts sitemaps if needed (sitemap-posts-2.xml, etc.)
    for (let i = 2; i <= totalPostsSitemaps + 1; i++) {
        sitemapIndex += `
    <sitemap>
        <loc>${baseUrl}/sitemap-posts-${i}.xml</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
    </sitemap>`;
    }

    sitemapIndex += '\n</sitemapindex>';

    return new Response(sitemapIndex, {
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600' // 1 hour cache
        }
    });
}

// Generate individual posts sitemap
async function generatePostsSitemap(context, sitemapIndex) {
    const baseUrl = context.env.SITE_URL || SITEMAP_BASE_URL;
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Get all posts
    const allPosts = await getAllPosts(context);
    
    // Calculate slice for this sitemap
    const startIndex = sitemapIndex * MAX_URLS_PER_SITEMAP;
    const endIndex = Math.min(startIndex + MAX_URLS_PER_SITEMAP, allPosts.length);
    const postsSlice = allPosts.slice(startIndex, endIndex);
    
    // Determine if this is the first sitemap (includes homepage)
    const isFirstSitemap = sitemapIndex === 0;

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // Add homepage only to first sitemap
    if (isFirstSitemap) {
        sitemap += `
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;
    }

    // Add posts for this sitemap
    for (const post of postsSlice) {
        const postUrl = `${baseUrl}/review/${post.slug}`;
        
        sitemap += `
    <url>
        <loc>${escapeXml(postUrl)}</loc>
        <lastmod>${cleanDate(post.lastmod)}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>`;
    }

    sitemap += '\n</urlset>';

    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600', // 1 hour cache
            'X-Sitemap-Index': (sitemapIndex + 1).toString(),
            'X-Total-URLs': postsSlice.length.toString()
        }
    });
}

// Cache and fetch all posts (optimized)
let postsCache = null;
let cacheTime = 0;
const CACHE_TTL = 3600000; // 1 hour

async function getAllPosts(context) {
    const now = Date.now();
    
    // Return cached posts if still valid
    if (postsCache && (now - cacheTime) < CACHE_TTL) {
        return postsCache;
    }
    
    // Fetch and cache new posts
    postsCache = await fetchAllPostsOptimized(context);
    cacheTime = now;
    
    return postsCache;
}

// Fetch all posts with single API call
async function fetchAllPostsOptimized(context) {
    try {
        // Single API call to get repository structure
        const response = await fetch(
            'https://api.github.com/repos/yourfreetools/reviewindex/git/trees/main?recursive=1',
            {
                headers: {
                    'Authorization': `token ${context.env.GITHUB_TOKEN}`,
                    'User-Agent': 'ReviewIndex-Sitemap',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const treeData = await response.json();
        
        // Process all markdown files in reviews directory
        const posts = treeData.tree
            .filter(item => 
                item.path.startsWith('content/reviews/') && 
                item.path.endsWith('.md') &&
                !item.path.includes('/templates/') // Exclude template directories
            )
            .map(file => {
                const filename = file.path.split('/').pop().replace('.md', '');
                return {
                    slug: generateValidSlug(filename),
                    lastmod: extractLastModDate(file) || new Date().toISOString().split('T')[0],
                    path: file.path
                };
            })
            .sort((a, b) => b.slug.localeCompare(a.slug)); // Sort for consistent ordering

        console.log(`Found ${posts.length} posts for sitemap`);
        return posts;

    } catch (error) {
        console.error('Error fetching posts:', error);
        return []; // Return empty array on error
    }
}

// Extract last modified date from git file info
function extractLastModDate(file) {
    if (file.last_modified) {
        return cleanDate(file.last_modified);
    }
    return new Date().toISOString().split('T')[0];
}

// Error response - fallback to basic sitemap
function generateErrorSitemap() {
    const baseUrl = SITEMAP_BASE_URL;
    const currentDate = new Date().toISOString().split('T')[0];
    
    const fallbackSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>`;

    return new Response(fallbackSitemap, {
        status: 200,
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=300' // 5 minutes on error
        }
    });
        }
