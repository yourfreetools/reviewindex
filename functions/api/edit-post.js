// functions/api/edit-post.js
export async function onRequestPost(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS, GET, PUT',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (context.request.method === 'OPTIONS') {
        return new Response(null, { 
            status: 200,
            headers: corsHeaders 
        });
    }

    try {
        const { GITHUB_TOKEN } = context.env;
        
        if (!GITHUB_TOKEN) {
            return errorResponse('GITHUB_TOKEN not configured', 500, corsHeaders);
        }

        const { action, filename, content, frontmatter } = await context.request.json();

        if (!filename) {
            return errorResponse('Filename is required', 400, corsHeaders);
        }

        const REPO_OWNER = 'yourfreetools';
        const REPO_NAME = 'reviewindex';
        const filePath = `content/reviews/${filename}`;

        if (action === 'get') {
            // Get file content
            const response = await fetch(
                `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
                {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'User-Agent': 'Review-Index-App'
                    }
                }
            );

            if (!response.ok) {
                return errorResponse('Post not found', 404, corsHeaders);
            }

            const fileData = await response.json();
            const fileContent = atob(fileData.content);
            
            // Parse frontmatter and content
            const { frontmatter: fm, content: postContent } = parseMarkdown(fileContent);
            
            return successResponse({
                frontmatter: fm,
                content: postContent,
                sha: fileData.sha
            }, corsHeaders);

        } else if (action === 'update') {
            if (!content || !frontmatter) {
                return errorResponse('Content and frontmatter are required', 400, corsHeaders);
            }

            // Reconstruct markdown with frontmatter
            const fullContent = reconstructMarkdown(frontmatter, content);
            const encodedContent = btoa(unescape(encodeURIComponent(fullContent)));

            const response = await fetch(
                `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Review-Index-App'
                    },
                    body: JSON.stringify({
                        message: `Update post: ${frontmatter.title}`,
                        content: encodedContent,
                        sha: frontmatter.sha // Required for updates
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                return errorResponse(errorData.message || 'Update failed', 400, corsHeaders);
            }

            return successResponse({
                message: 'Post updated successfully',
                url: `https://reviewindex.pages.dev/review/${filename.replace('.md', '')}`
            }, corsHeaders);

        } else {
            return errorResponse('Invalid action', 400, corsHeaders);
        }

    } catch (error) {
        return errorResponse(error.message, 500, corsHeaders);
    }
}

function parseMarkdown(content) {
    const frontmatter = {};
    let postContent = content;
    
    // Parse YAML frontmatter
    if (content.startsWith('---')) {
        const end = content.indexOf('---', 3);
        if (end !== -1) {
            const yaml = content.substring(3, end).trim();
            postContent = content.substring(end + 3).trim();
            
            yaml.split('\n').forEach(line => {
                const colon = line.indexOf(':');
                if (colon > 0) {
                    const key = line.substring(0, colon).trim();
                    let value = line.substring(colon + 1).trim();
                    
                    // Remove quotes
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    }
                    
                    frontmatter[key] = value;
                }
            });
        }
    }
    
    return { frontmatter, content: postContent };
}

function reconstructMarkdown(frontmatter, content) {
    let yaml = '---\n';
    Object.keys(frontmatter).forEach(key => {
        if (key !== 'sha' && key !== 'content') {
            yaml += `${key}: "${frontmatter[key]}"\n`;
        }
    });
    yaml += '---\n\n';
    
    return yaml + content;
}

function errorResponse(message, status, headers) {
    return new Response(JSON.stringify({ 
        success: false, 
        message 
    }), {
        status,
        headers: { 
            ...headers, 
            'Content-Type': 'application/json' 
        },
    });
}

function successResponse(data, headers) {
    return new Response(JSON.stringify({ 
        success: true, 
        ...data 
    }), {
        status: 200,
        headers: { 
            ...headers, 
            'Content-Type': 'application/json' 
        },
    });
}
