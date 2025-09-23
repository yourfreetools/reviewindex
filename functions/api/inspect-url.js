export async function onRequestGet(context) {
    const url = new URL(context.request.url);
    const inspectUrl = url.searchParams.get('url');
    
    if (!inspectUrl) {
        return new Response(JSON.stringify({ error: 'URL parameter required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    const urlData = {
        url: inspectUrl,
        last_crawled: new Date().toISOString(),
        status: 'active',
        content_type: 'text/html'
    };
    
    return new Response(JSON.stringify(urlData), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300'
        }
    });
}
