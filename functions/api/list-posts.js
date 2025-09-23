export async function onRequestGet(context) {
    try {
        console.log('Fetching posts from GitHub...');
        
        // Your GitHub repository details
        const response = await fetch('https://api.github.com/repos/yourfreetools/reviewindex/contents/content/reviews', {
            headers: {
                'Authorization': `token ${context.env.GITHUB_TOKEN}`,
                'User-Agent': 'ReviewIndex-API',
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        console.log('GitHub API response status:', response.status);

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${await response.text()}`);
        }

        const files = await response.json();
        console.log(`Found ${files.length} files in repository`);

        // Filter only markdown files and create post objects
        const posts = files
            .filter(file => file.name.endsWith('.md'))
            .map(file => {
                const slug = file.name.replace('.md', '');
                return {
                    filename: file.name,
                    title: slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    excerpt: 'Comprehensive review and analysis...',
                    image: null,
                    rating: '4',
                    date: new Date().toISOString().split('T')[0],
                    url: `/review/${slug}`
                };
            });

        console.log(`Processed ${posts.length} posts`);

        return new Response(JSON.stringify({
            success: true,
            posts: posts,
            count: posts.length,
            lastUpdated: new Date().toISOString()
        }), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=300'
            }
        });

    } catch (error) {
        console.error('Error in list-posts API:', error);
        
        return new Response(JSON.stringify({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
