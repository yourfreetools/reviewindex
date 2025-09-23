export async function onRequestGet(context) {
    try {
        const baseUrl = context.env.SITE_URL || 'https://reviewindex.pages.dev';
        const posts = await fetchPostsFromGitHub(context);
        
        let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ReviewIndex Sitemap</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        h1 { color: #2563eb; }
        .post-list { list-style: none; padding: 0; }
        .post-item { margin: 10px 0; }
        .post-link { text-decoration: none; color: #2563eb; }
        .post-link:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>ReviewIndex Sitemap</h1>
    <p>Last updated: ${new Date().toISOString().split('T')[0]}</p>
    
    <h2>Product Reviews</h2>
    <ul class="post-list">`;
    
        posts.forEach(post => {
            html += `
        <li class="post-item">
            <a href="${baseUrl}/review/${post.slug}" class="post-link">${post.title}</a>
            <span> - ${post.date}</span>
        </li>`;
        });
    
        html += `
    </ul>
    
    <p><a href="/sitemap.xml">XML Sitemap</a> for search engines</p>
</body>
</html>`;

        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'public, max-age=3600'
            }
        });

    } catch (error) {
        return new Response(`<html><body><h1>Sitemap</h1><p>Unable to load sitemap at this time.</p></body></html>`, {
            headers: { 'Content-Type': 'text/html' }
        });
    }
}
