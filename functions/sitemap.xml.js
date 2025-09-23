export async function onRequestGet(context) {
    try {
        const url = new URL(context.request.url);
        const sitemapType = url.searchParams.get('type') || 'main';
        
        switch (sitemapType) {
            case 'posts':
                return await generatePostsSitemap(context);
            case 'categories':
                return await generateCategoriesSitemap(context);
            default:
                return await generateMainSitemap(context);
        }
    } catch (error) {
        console.error('Sitemap generation error:', error);
        return generateErrorSitemap();
    }
}

// Generate main sitemap index
async function generateMainSitemap(context) {
    const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
    const currentDate = new Date().toISOString().split('T')[0];
    
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap>
        <loc>${baseUrl}/sitemap.xml?type=posts</loc>
        <lastmod>${currentDate}</lastmod>
    </sitemap>
    <sitemap>
        <loc>${baseUrl}/sitemap.xml?type=categories</loc>
        <lastmod>${currentDate}</lastmod>
    </sitemap>
</sitemapindex>`;

    return new Response(sitemapIndex, {
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600' // 1 hour cache
        }
    });
}

// Generate posts sitemap
async function generatePostsSitemap(context) {
    try {
        const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
        const currentDate = new Date().toISOString().split('T')[0];
        
        // Fetch posts from GitHub
        const posts = await fetchPostsFromGitHub(context);
        
        let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">`;

        // Add homepage
        sitemap += `
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${currentDate}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;

        // Add each post
        for (const post of posts) {
            const postUrl = `${baseUrl}/review/${post.slug}`;
            const lastmod = post.lastmod || currentDate;
            const priority = post.featured ? '0.9' : '0.7';
            
            sitemap += `
    <url>
        <loc>${escapeXml(postUrl)}</loc>
        <lastmod>${lastmod}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>${priority}</priority>`;
            
            // Add image if exists
            if (post.image) {
                sitemap += `
        <image:image>
            <image:loc>${escapeXml(post.image)}</image:loc>
            <image:title>${escapeXml(post.title)} Review</image:title>
        </image:image>`;
            }
            
            // Add news data if post is recent
            const postDate = new Date(post.date || lastmod);
            const daysAgo = (new Date() - postDate) / (1000 * 60 * 60 * 24);
            
            if (daysAgo < 3) { // Post is less than 3 days old
                sitemap += `
        <news:news>
            <news:publication>
                <news:name>ReviewIndex</news:name>
                <news:language>en</news:language>
            </news:publication>
            <news:publication_date>${postDate.toISOString().split('T')[0]}</news:publication_date>
            <news:title>${escapeXml(post.title)} Review</news:title>
        </news:news>`;
            }
            
            sitemap += `
    </url>`;
        }

        sitemap += '\n</urlset>';

        return new Response(sitemap, {
            headers: {
                'Content-Type': 'application/xml',
                'Cache-Control': 'public, max-age=86400' // 24 hours cache
            }
        });

    } catch (error) {
        console.error('Posts sitemap error:', error);
        return generateFallbackSitemap(context);
    }
}

// Generate categories sitemap
async function generateCategoriesSitemap(context) {
    const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Extract categories from posts
    const posts = await fetchPostsFromGitHub(context);
    const categories = [...new Set(posts.map(post => post.category).filter(Boolean))];
    
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

    // Add category pages (you might want to create these pages later)
    categories.forEach(category => {
        const categoryUrl = `${baseUrl}/category/${encodeURIComponent(category.toLowerCase())}`;
        sitemap += `
    <url>
        <loc>${escapeXml(categoryUrl)}</loc>
        <lastmod>${currentDate}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.6</priority>
    </url>`;
    });

    sitemap += '\n</urlset>';

    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=86400'
        }
    });
}

// Fetch posts from GitHub with enhanced metadata
async function fetchPostsFromGitHub(context) {
    // Updated with correct repository and path
    const response = await fetch('https://api.github.com/repos/yourfreetools/reviewindex/contents/content/reviews', {
        headers: {
            'Authorization': `token ${context.env.GITHUB_TOKEN}`,
            'User-Agent': 'ReviewIndex-Sitemap',
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
    }

    const files = await response.json();
    const posts = [];

    for (const file of files) {
        if (file.name.endsWith('.md')) {
            try {
                const postContent = await fetch(file.download_url).then(r => r.text());
                const metadata = extractPostMetadata(postContent, file.name);
                
                posts.push({
                    slug: file.name.replace('.md', ''),
                    title: metadata.title,
                    date: metadata.date,
                    lastmod: metadata.lastmod || metadata.date,
                    category: metadata.category,
                    image: metadata.image,
                    featured: metadata.featured || false,
                    excerpt: metadata.excerpt
                });
            } catch (error) {
                console.warn(`Failed to process ${file.name}:`, error);
                // Add basic post info even if metadata extraction fails
                posts.push({
                    slug: file.name.replace('.md', ''),
                    title: escapeXml(file.name.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())),
                    date: new Date().toISOString().split('T')[0],
                    lastmod: new Date().toISOString().split('T')[0],
                    category: 'General'
                });
            }
        }
    }

    // Sort by date (newest first)
    return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Extract metadata from markdown frontmatter and escape XML
function extractPostMetadata(content, filename) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const metadata = {
        title: escapeXml(filename.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())),
        date: new Date().toISOString().split('T')[0],
        category: 'General'
    };

    if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const lines = frontmatter.split('\n');
        
        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const key = match[1].toLowerCase();
                const value = match[2].trim();
                
                switch (key) {
                    case 'title':
                        metadata.title = escapeXml(value);
                        break;
                    case 'date':
                        metadata.date = value;
                        metadata.lastmod = value;
                        break;
                    case 'category':
                        metadata.category = escapeXml(value);
                        break;
                    case 'image':
                        metadata.image = escapeXml(value);
                        break;
                    case 'featured':
                        metadata.featured = value.toLowerCase() === 'true';
                        break;
                    case 'excerpt':
                        metadata.excerpt = escapeXml(value);
                        break;
                }
            }
        }
    }

    return metadata;
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

function generateFallbackSitemap() {
    const baseUrl = 'https://reviewindex.pages.dev';
    const currentDate = new Date().toISOString().split('T')[0];
    
    const fallbackSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${currentDate}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>`;

    return new Response(fallbackSitemap, {
        headers: { 'Content-Type': 'application/xml' }
    });
}

function generateErrorSitemap() {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<error>
    <message>Unable to generate sitemap at this time. Please try again later.</message>
    <timestamp>${new Date().toISOString()}</timestamp>
</error>`, {
        status: 500,
        headers: { 'Content-Type': 'application/xml' }
    });
}
