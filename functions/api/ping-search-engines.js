// functions/api/ping-search-engines.js
export async function onRequestPost(context) {
    const sitemapUrl = 'https://reviewindex.pages.dev/sitemap.xml';
    
    // Ping Google
    await fetch(`http://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
    
    // Ping Bing
    await fetch(`http://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`);
    
    return new Response(JSON.stringify({ 
        success: true, 
        message: 'Search engines notified',
        timestamp: new Date().toISOString()
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
