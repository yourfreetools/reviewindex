// Utility: Clean date for sitemap
function cleanDate(dateString) {
    if (!dateString) return new Date().toISOString().split('T')[0];
    const cleaned = dateString.toString().replace(/["']/g, '').split('T')[0];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(cleaned)) return new Date().toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    return cleaned > today ? today : cleaned;
}

// Utility: Generate valid URL slug
function generateValidSlug(rawSlug) {
    if (!rawSlug) return 'untitled';
    return rawSlug
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// Utility: Escape XML characters
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Extract frontmatter metadata
function extractPostMetadata(content, filename) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const metadata = {
        title: filename.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        date: new Date().toISOString().split('T')[0],
        lastmod: new Date().toISOString().split('T')[0]
    };

    if (frontmatterMatch) {
        const lines = frontmatterMatch[1].split('\n');
        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const key = match[1].toLowerCase();
                const value = match[2].trim();
                if (key === 'date') metadata.date = value;
                if (key === 'lastmod') metadata.lastmod = value;
                if (key === 'title') metadata.title = value;
                if (key === 'slug') metadata.slug = generateValidSlug(value);
            }
        }
    }
    return metadata;
}

// Fetch posts from GitHub repo
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
    const posts = [];

    for (const file of files) {
        if (file.type === 'file' && file.name.endsWith('.md')) {
            const postContent = await fetch(file.download_url).then(r => r.text());
            const meta = extractPostMetadata(postContent, file.name);
            posts.push({
                slug: meta.slug || generateValidSlug(file.name.replace('.md', '')),
                lastmod: cleanDate(meta.lastmod || meta.date)
            });
        }
    }
    return posts.sort((a, b) => new Date(b.lastmod) - new Date(a.lastmod));
}

// Main sitemap handler
export async function onRequestGet(context) {
    try {
        const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
        const currentDate = new Date().toISOString().split('T')[0];

        const posts = await fetchPostsFromGitHub(context);

        let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${cleanDate(currentDate)}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;

        for (const post of posts) {
            const postUrl = `${baseUrl}/review/${post.slug}`;
            sitemap += `
    <url>
        <loc>${escapeXml(postUrl)}</loc>
        <lastmod>${post.lastmod}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>`;
        }

        sitemap += `
</urlset>`;

        return new Response(sitemap, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=86400'
            }
        });

    } catch (error) {
        console.error('Sitemap generation error:', error);

        const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${escapeXml(context.env.SITE_URL || 'https://reviewindex.pages.dev')}</loc>
        <lastmod>${cleanDate(new Date().toISOString())}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>`;

        return new Response(fallback, {
            headers: {
                'Content-Type': 'application/xml; charset=utf-8'
            }
        });
    }
}
