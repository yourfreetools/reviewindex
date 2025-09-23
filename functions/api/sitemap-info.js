export async function onRequestGet(context) {
    try {
        const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
        const posts = await fetchPostsFromGitHub(context);
        
        const sitemapInfo = {
            generated: new Date().toISOString(),
            sitemaps: {
                main: `${baseUrl}/sitemap.xml`,
                posts: `${baseUrl}/sitemap.xml?type=posts`,
                categories: `${baseUrl}/sitemap.xml?type=categories`
            },
            stats: {
                total_posts: posts.length,
                categories: [...new Set(posts.map(p => p.category).filter(Boolean))].length,
                last_updated: posts[0]?.lastmod || new Date().toISOString().split('T')[0]
            },
            posts: posts.map(post => ({
                slug: post.slug,
                title: post.title,
                url: `${baseUrl}/review/${post.slug}`,
                lastmod: post.lastmod,
                category: post.category,
                featured: post.featured
            }))
        };

        return new Response(JSON.stringify(sitemapInfo, null, 2), {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Failed to generate sitemap info',
            details: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Reuse the fetch function from sitemap.xml.js
async function fetchPostsFromGitHub(context) {
    // Implementation same as above...
}
