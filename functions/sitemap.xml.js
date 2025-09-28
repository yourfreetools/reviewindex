// sitemap.xml.js

// Utility to clean dates to YYYY-MM-DD
function cleanDate(dateString) {
    if (!dateString) return new Date().toISOString().split('T')[0];
    const cleaned = dateString.toString().replace(/["']/g, '').split('T')[0];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date().toISOString().split('T')[0];
    return dateRegex.test(cleaned) ? (cleaned > today ? today : cleaned) : today;
}

// Slug generator
function generateValidSlug(rawSlug) {
    if (!rawSlug) return 'untitled';
    return rawSlug
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// XML escape
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
    const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
    const currentDate = new Date().toISOString().split('T')[0];

    try {
        // Fetch list of post files from GitHub (single API call)
        const response = await fetch(
            'https://api.github.com/repos/yourfreetools/reviewindex/contents/content/reviews',
            {
                headers: {
                    'Authorization': `token ${context.env.GITHUB_TOKEN}`,
                    'User-Agent': 'ReviewIndex-Sitemap',
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        const files = await response.json();

        // Generate URL entries for posts
        const postsUrls = files
            .filter(file => file.type === 'file' && file.name.endsWith('.md'))
            .map(file => {
                const slug = generateValidSlug(file.name.replace('.md', ''));
                return `
    <url>
        <loc>${escapeXml(baseUrl + '/review/' + slug)}</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>`;
            })
            .join('');

        // Build the full sitemap (including homepage)
        const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>${postsUrls}
</urlset>`;

        return new Response(sitemap, {
            headers: {
                'Content-Type': 'application/xml',
                'Cache-Control': 'public, max-age=86400'
            }
        });

    } catch (error) {
        console.error('Sitemap generation error:', error);
        const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>`;
        return new Response(fallback, {
            headers: { 'Content-Type': 'application/xml' }
        });
    }
}
