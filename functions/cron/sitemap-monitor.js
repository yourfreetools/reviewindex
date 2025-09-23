// This would be set up as a scheduled function to monitor sitemap health
export async function scheduled(event, env, ctx) {
    try {
        const sitemapUrl = `${env.SITE_URL}/sitemap.xml`;
        const response = await fetch(sitemapUrl);
        
        if (!response.ok) {
            // Send alert or log error
            console.error('Sitemap health check failed:', response.status);
        }
        
        // Log sitemap stats
        const statsResponse = await fetch(`${env.SITE_URL}/api/sitemap-info`);
        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            console.log('Sitemap Stats:', {
                posts: stats.stats.total_posts,
                lastUpdated: stats.stats.last_updated,
                generated: stats.generated
            });
        }
        
    } catch (error) {
        console.error('Sitemap monitor error:', error);
    }
}
