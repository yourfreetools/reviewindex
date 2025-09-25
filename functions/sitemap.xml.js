export async function onRequestGet(context) {
    try {
        const url = new URL(context.request.url);
        const sitemapType = url.searchParams.get('type') || 'main';
        
        switch (sitemapType) {
            case 'posts':
                return await generatePostsSitemap(context);
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
    const currentDate = new Date().toISOString();
    
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap>
        <loc>${baseUrl}/sitemap.xml?type=posts</loc>
        <lastmod>${currentDate.split('T')[0]}</lastmod>
    </sitemap>
</sitemapindex>`;

    return new Response(sitemapIndex, {
        headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=86400'
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
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${escapeXml(baseUrl)}</loc>
        <lastmod>${currentDate}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;

        // Add each post
        for (const post of posts) {
            const postUrl = `${baseUrl}/review/${post.slug}`;
            const lastmod = post.lastmod || post.date || currentDate;
            
            sitemap += `
    <url>
        <loc>${escapeXml(postUrl)}</loc>
        <lastmod>${lastmod.split('T')[0]}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.8</priority>
    </url>`;
        }

        sitemap += '\n</urlset>';

        return new Response(sitemap, {
            headers: {
                'Content-Type': 'application/xml',
                'Cache-Control': 'public, max-age=86400'
            }
        });

    } catch (error) {
        console.error('Posts sitemap error:', error);
        return generateFallbackSitemap(context);
    }
}

// Fetch posts from GitHub - UPDATED PATH
async function fetchPostsFromGitHub(context) {
    // Updated to point to content/reviews/fi.md files
    const response = await fetch('https://api.github.com/repos/yourfreetools/reviewindex/contents/content/reviews/fi.md', {
        headers: {
            'Authorization': `token ${context.env.GITHUB_TOKEN}`,
            'User-Agent': 'ReviewIndex-Sitemap',
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (!response.ok) {
        // If the specific path doesn't work, try the directory
        const dirResponse = await fetch('https://api.github.com/repos/yourfreetools/reviewindex/contents/content/reviews', {
            headers: {
                'Authorization': `token ${context.env.GITHUB_TOKEN}`,
                'User-Agent': 'ReviewIndex-Sitemap',
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!dirResponse.ok) {
            throw new Error(`GitHub API error: ${response.status} and ${dirResponse.status}`);
        }
        
        const files = await dirResponse.json();
        return processFiles(files);
    }

    // If it's a single file, handle it differently
    const fileData = await response.json();
    return processFiles([fileData]);
}

// Process files array
async function processFiles(files) {
    const posts = [];

    for (const file of files) {
        if (file.name.endsWith('.md') && file.type === 'file') {
            try {
                const postContent = await fetch(file.download_url).then(r => r.text());
                const metadata = extractPostMetadata(postContent, file.name);
                
                posts.push({
                    slug: file.name.replace('.md', ''),
                    title: metadata.title,
                    date: metadata.date,
                    lastmod: metadata.lastmod || metadata.date
                });
            } catch (error) {
                console.warn(`Failed to process ${file.name}:`, error);
                // Basic fallback
                posts.push({
                    slug: file.name.replace('.md', ''),
                    date: new Date().toISOString().split('T')[0],
                    lastmod: new Date().toISOString().split('T')[0]
                });
            }
        } else if (file.type === 'dir') {
            // If it's a directory, fetch its contents
            try {
                const dirResponse = await fetch(file.url);
                if (dirResponse.ok) {
                    const dirFiles = await dirResponse.json();
                    const dirPosts = await processFiles(dirFiles);
                    posts.push(...dirPosts);
                }
            } catch (error) {
                console.warn(`Failed to process directory ${file.name}:`, error);
            }
        }
    }

    return posts.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Extract basic metadata from markdown
function extractPostMetadata(content, filename) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    const metadata = {
        title: filename.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        date: new Date().toISOString().split('T')[0]
    };

    if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const lines = frontmatter.split('\n');
        
        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const key = match[1].toLowerCase();
                const value = match[2].trim();
                
                if (key === 'date') {
                    metadata.date = value;
                    metadata.lastmod = value;
                } else if (key === 'lastmod') {
                    metadata.lastmod = value;
                } else if (key === 'title') {
                    metadata.title = value;
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

// Fallback sitemap with just homepage
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

// Error response
function generateErrorSitemap() {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<error>
    <message>Unable to generate sitemap at this time. Please try again later.</message>
</error>`, {
        status: 500,
        headers: { 'Content-Type': 'application/xml' }
    });
                                          }
