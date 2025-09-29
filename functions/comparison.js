// functions/comparison.js
export async function onRequest(context) {
    const { request, env } = context;
    
    try {
        // Fetch all comparison files from GitHub for search functionality
        const allComparisons = await fetchAllComparisons(env.GITHUB_TOKEN);
        
        // Get URL parameters for search
        const url = new URL(request.url);
        const searchQuery = url.searchParams.get
