// Date cleaning function
function cleanDate(dateString) {
    if (!dateString) return new Date().toISOString().split('T')[0];
    const cleaned = dateString.toString().replace(/["']/g, '').split('T')[0];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(cleaned)) return new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    return cleaned > today ? today : cleaned;
}

// Slug validation
function generateValidSlug(rawSlug) {
    if (!rawSlug) return 'untitled';
    return rawSlug.toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// XML escaping
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export async function onRequestGet(context) {
    try {
        const url = new URL(context.request.url);
        const path = url.pathname; // e.g. /sitemap.xml, /sitemap-1.xml
        if (path === '/sitemap.xml') {
            return await generateMainSitemap(context);
        } else if (path.startsWith('/sitemap-')) {
            const index = parseInt(path.replace('/sitemap-', '').replace('.xml', ''), 10);
            return await generatePostsSitemap(context, index);
        }
        return generateErrorSitemap();
    } catch (error) {
        console.error('Sitemap generation error:', error);
        return generateErrorSitemap();
    }
}

// Sitemap index
async function generateMainSitemap(context) {
    const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
    const posts = await fetchPostsFromGitHub(context);
    const chunkSize = 50000;
    const totalChunks = Math.ceil(posts.length / chunkSize);
    const currentDate = new Date().toISOString().split('T')[0];

    let sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
    for (let i = 1; i <= totalChunks; i++) {
        sitemapIndex += `
    <sitemap>
        <loc>${baseUrl}/sitemap-${i}.xml</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
    </sitemap>`;
    }
    sitemapIndex += `\n</sitemapindex>`;

    return new Response(sitemapIndex, {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' }
    });
}

// Generate chunked post sitemaps
async function generatePostsSitemap(context, chunkIndex) {
    const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
    const posts = await fetchPostsFromGitHub(context);
    const chunkSize = 50000;
    const start = (chunkIndex - 1) * chunkSize;
    const end = start + chunkSize;
    const chunk = posts.slice(start, end);

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
    
    // Homepage
    sitemap += `
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${cleanDate(new Date().toISOString())}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;

    // Posts
    for (const post of chunk) {
        const postUrl = `${baseUrl}/review/${generateValidSlug(post.slug)}`;
        sitemap += `
    <url>
        <loc>${escapeXml(postUrl)}</loc>
        <lastmod>${cleanDate(post.lastmod)}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>`;
    }

    sitemap += `\n</urlset>`;

    return new Response(sitemap, {
        headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400' }
    });
}

// Fetch posts metadata from GitHub (only filenames + metadata, no content fetch)
async function fetchPostsFromGitHub(context) {
    const response = await fetch('https://api.github.com/repos/yourfreetools/reviewindex/contents/content/reviews', {
        headers: {
            'Authorization': `token ${context.env.GITHUB_TOKEN}`,
            'User-Agent': 'ReviewIndex-Sitemap',
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
    const files = await response.json();

    return files
        .filter(file => file.name.endsWith('.md'))
        .map(file => ({
            slug: file.name.replace('.md', ''),
            lastmod: cleanDate(file.git_url?.last_modified || file.sha || new Date().toISOString())
        }));
}

// Error sitemap
function generateErrorSitemap() {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<error><message>Unable to generate sitemap at this time</message></error>`, {
        status: 500,
        headers: { 'Content-Type': 'application/xml' }
    });
}
