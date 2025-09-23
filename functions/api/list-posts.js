// functions/api/list-posts.js
export async function onRequestGet(context) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    try {
        const { GITHUB_TOKEN } = context.env;
        
        if (!GITHUB_TOKEN) {
            return errorResponse('GITHUB_TOKEN not configured', 500, corsHeaders);
        }

        const REPO_OWNER = 'yourfreetools';
        const REPO_NAME = 'reviewindex';
        
        const response = await fetch(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/content/reviews`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'User-Agent': 'Review-Index-App'
                }
            }
        );

        if (!response.ok) {
            return errorResponse('Failed to fetch posts', response.status, corsHeaders);
        }

        const files = await response.json();
        const posts = files
            .filter(file => file.name.endsWith('.md'))
            .map(file => ({
                filename: file.name,
                path: file.path,
                url: file.download_url,
                size: file.size,
                sha: file.sha
            }));

        return successResponse({ posts }, corsHeaders);

    } catch (error) {
        return errorResponse(error.message, 500, corsHeaders);
    }
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
