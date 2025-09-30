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
const MAX_URLS_PER_SITEMAP = 50000;
const SITEMAP_BASE_URL = 'https://reviewindex.pages.dev';

export async function onRequestGet(context) {
    try {
        const url = new URL(context.request.url);
        const pathname = url.pathname;
        
        console.log('Sitemap request for:', pathname);
        
        // Handle main sitemap index
        if (pathname === '/sitemap-index.xml') {
            return await generateMainSitemapIndex(context);
        }
        // Handle individual sitemap files
        else if (pathname === '/sitemap.xml') {
            return await generatePrimarySitemap(context);
        }
        else if (pathname.startsWith('/sitemap-')) {
            const match = pathname.match(/\/sitemap-(\d+)\.xml/);
            if (match) {
                const index = parseInt(match[1]);
                return await generateSecondarySitemap(context, index);
            }
        }
        
        // Default to primary sitemap
        return await generatePrimarySitemap(context);
        
    } catch (error) {
        console.error('Sitemap generation error:', error);
        return generateErrorSitemap();
    }
}

// Generate main sitemap index (sitemap-index.xml)
async function generateMainSitemapIndex(context) {
    const baseUrl = context.env.SITE_URL || SITEMAP_BASE_URL;
    const currentDate = new Date().toISOString();
    
    // Get all content to calculate how many sitemaps we need
    const allContent = await getAllContent(context);
    console.log(`Total URLs found: ${allContent.length}`);
    
    // Calculate total URLs (content + homepage)
    const totalUrls = allContent.length + 1;
    const totalSitemaps = Math.ceil(totalUrls / MAX_URLS_PER_SITEMAP);
    
    let sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // Always include the primary sitemap.xml
    sitemapIndex += `
    <sitemap>
        <loc>${baseUrl}/sitemap.xml</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
    </sitemap>`;

    // Add secondary sitemaps if needed (sitemap-1.xml, sitemap-2.xml, etc.)
    for (let i = 1; i < totalSitemaps; i++) {
        sitemapIndex += `
    <sitemap>
        <loc>${baseUrl}/sitemap-${i}.xml</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
    </sitemap>`;
    }

    sitemapIndex += '\n</sitemapindex>';

    return new Response(sitemapIndex, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600'
        }
    });
}

// Generate primary sitemap (sitemap.xml) - contains first batch of URLs
async function generatePrimarySitemap(context) {
    return await generateSitemapByIndex(context, 0);
}

// Generate secondary sitemaps (sitemap-1.xml, sitemap-2.xml, etc.)
async function generateSecondarySitemap(context, index) {
    return await generateSitemapByIndex(context, index);
}

// Generate sitemap by index
async function generateSitemapByIndex(context, sitemapIndex) {
    const baseUrl = context.env.SITE_URL || SITEMAP_BASE_URL;
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Get all content
    const allContent = await getAllContent(context);
    const totalUrls = allContent.length + 1; // +1 for homepage
    
    // Calculate URL ranges for this sitemap
    const startIndex = sitemapIndex * MAX_URLS_PER_SITEMAP;
    let endIndex = (sitemapIndex + 1) * MAX_URLS_PER_SITEMAP;
    
    // Adjust for homepage in first sitemap
    let urlCount = 0;
    let contentSlice = [];
    
    if (sitemapIndex === 0) {
        // First sitemap: homepage + content
        urlCount = 1; // homepage
        contentSlice = allContent.slice(0, MAX_URLS_PER_SITEMAP - 1);
        urlCount += contentSlice.length;
    } else {
        // Subsequent sitemaps: only content
        const contentStartIndex = startIndex - 1; // Account for homepage in first sitemap
        contentSlice = allContent.slice(contentStartIndex, endIndex - 1);
        urlCount = contentSlice.length;
    }
    
    console.log(`Sitemap ${sitemapIndex}: ${urlCount} URLs (${contentSlice.length} content items)`);

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // Add homepage only to first sitemap
    if (sitemapIndex === 0) {
        sitemap += `
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;
    }

    // Add content for this sitemap
    for (const item of contentSlice) {
        const itemUrl = `${baseUrl}${item.url}`;
        
        sitemap += `
    <url>
        <loc>${escapeXml(itemUrl)}</loc>
        <lastmod>${cleanDate(item.lastmod)}</lastmod>
        <changefreq>${item.changefreq || 'monthly'}</changefreq>
        <priority>${item.priority || '0.8'}</priority>
    </url>`;
    }

    sitemap += '\n</urlset>';

    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600'
        }
    });
}

// Cache and fetch all content
let contentCache = null;
let cacheTime = 0;
const CACHE_TTL = 3600000; // 1 hour

async function getAllContent(context) {
    const now = Date.now();
    
    // Return cached content if still valid
    if (contentCache && (now - cacheTime) < CACHE_TTL) {
        return contentCache;
    }
    
    // Fetch and cache new content
    contentCache = await fetchAllContentOptimized(context);
    cacheTime = now;
    
    return contentCache;
}

// Fetch all content with single API call
async function fetchAllContentOptimized(context) {
    try {
        console.log('Fetching content from GitHub...');
        
        const response = await fetch(
            'https://api.github.com/repos/yourfreetools/reviewindex/git/trees/main?recursive=1',
            {
                headers: {
                    'Authorization': `Bearer ${context.env.GITHUB_TOKEN}`,
                    'User-Agent': 'ReviewIndex-Sitemap',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const treeData = await response.json();
        
        // Process reviews
        const reviews = treeData.tree
            .filter(item => 
                item.type === 'blob' &&
                item.path.startsWith('content/reviews/') && 
                item.path.endsWith('.md')
            )
            .map(file => {
                const filename = file.path.split('/').pop().replace('.md', '');
                return {
                    url: `/review/${generateValidSlug(filename)}`,
                    lastmod: new Date().toISOString().split('T')[0],
                    changefreq: 'monthly',
                    priority: '0.8'
                };
            });

        // Process comparisons
        const comparisons = treeData.tree
            .filter(item => 
                item.type === 'blob' &&
                item.path.startsWith('content/comparisons/') && 
                item.path.endsWith('.md')
            )
            .map(file => {
                const filename = file.path.split('/').pop().replace('.md', '');
                return {
                    url: `/comparison/${generateValidSlug(filename)}`,
                    lastmod: new Date().toISOString().split('T')[0],
                    changefreq: 'weekly',
                    priority: '0.9'
                };
            });

        // Combine all content
        const allContent = [...reviews, ...comparisons]
            .sort((a, b) => b.url.localeCompare(a.url));

        console.log(`Found ${reviews.length} reviews and ${comparisons.length} comparisons for sitemap`);
        return allContent;

    } catch (error) {
        console.error('Error fetching content:', error);
        return [];
    }
}

// Error response
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
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300'
        }
    });
}
