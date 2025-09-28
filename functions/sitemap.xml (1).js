// Date cleaning function
function cleanDate(dateString) {
    if (!dateString) return new Date().toISOString().split('T')[0];
    
    // Remove any quotation marks or invalid characters
    const cleaned = dateString.toString().replace(/["']/g, '').split('T')[0];
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(cleaned)) {
        return new Date().toISOString().split('T')[0];
    }
    
    // Ensure date is not in the future
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
        <lastmod>${cleanDate(currentDate)}</lastmod>
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
        <lastmod>${cleanDate(currentDate)}</lastmod>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;

        // Add each post
        for (const post of posts) {
            const postUrl = `${baseUrl}/review/${generateValidSlug(post.slug)}`;
            const lastmod = post.lastmod || post.date || currentDate;
            
            sitemap += `
    <url>
        <loc>${escapeXml(postUrl)}</loc>
        <lastmod>${cleanDate(lastmod)}</lastmod>
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
        return generateFallbackSitemap();
    }
}

// Fetch posts from GitHub - CORRECTED PATH
async function fetchPostsFromGitHub(context) {
    // Directly fetch from the reviews directory
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
    return processFiles(files);
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
                    slug: generateValidSlug(file.name.replace('.md', '')),
                    title: metadata.title,
                    date: cleanDate(metadata.date),
                    lastmod: cleanDate(metadata.lastmod || metadata.date)
                });
            } catch (error) {
                console.warn(`Failed to process ${file.name}:`, error);
                // Basic fallback with cleaned data
                posts.push({
                    slug: generateValidSlug(file.name.replace('.md', '')),
                    date: cleanDate(new Date().toISOString()),
                    lastmod: cleanDate(new Date().toISOString())
                });
            }
        } else if (file.type === 'dir') {
            // If it's a directory, fetch its contents
            try {
                const dirResponse = await fetch(file.url, {
                    headers: {
                        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
                        'User-Agent': 'ReviewIndex-Sitemap',
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
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
                } else if (key === 'slug') {
                    metadata.slug = generateValidSlug(value);
                }
            }
        }
    }

    return metadata;
}

// Fallback sitemap with just homepage
function generateFallbackSitemap() {
    const baseUrl = 'https://reviewindex.pages.dev';
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
