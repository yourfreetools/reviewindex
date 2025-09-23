// functions/api/get-post.js
export async function onRequestGet(context) {
    const { request } = context;
    const url = new URL(request.url);
    const filename = url.searchParams.get('filename');

    if (!filename) {
        return new Response(JSON.stringify({ error: 'Filename parameter required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const postContent = await fetchPostContent(filename, context.env.GITHUB_TOKEN);
        
        if (!postContent) {
            return new Response(JSON.stringify({ error: 'Post not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const { frontmatter } = parseMarkdown(postContent);
        return new Response(JSON.stringify({ 
            success: true, 
            frontmatter,
            filename 
        }), {
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: 'Server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Reuse the same helper functions from [...slug].js
async function fetchPostContent(filename, githubToken) {
    const REPO_OWNER = 'yourfreetools';
    const REPO_NAME = 'reviewindex';
    const filePath = `content/reviews/${filename}`;

    try {
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
            {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'Review-Index-App',
                    'Accept': 'application/vnd.github.v3.raw'
                }
            }
        );

        if (response.status === 200) {
            return await response.text();
        }
        return null;
    } catch (error) {
        return null;
    }
}

function parseMarkdown(content) {
    const frontmatter = {};
    let markdownContent = content;
    
    if (content.startsWith('---')) {
        const end = content.indexOf('---', 3);
        if (end !== -1) {
            const yaml = content.substring(3, end).trim();
            markdownContent = content.substring(end + 3).trim();
            
            yaml.split('\n').forEach(line => {
                const colon = line.indexOf(':');
                if (colon > 0) {
                    const key = line.substring(0, colon).trim();
                    let value = line.substring(colon + 1).trim();
                    
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    }
                    
                    frontmatter[key] = value;
                }
            });
        }
    }
    
    return { frontmatter, content: markdownContent };
}
