export async function onRequest(context) {
    try {
        const body = await context.request.json();
        const url = body.url;
        const apiKey = context.env.INDEXNOW_API_KEY;
        const indexNowEndpoint = `https://api.indexnow.org/indexnow?url=${encodeURIComponent(url)}&key=${apiKey}`;

        const response = await fetch(indexNowEndpoint, { method: 'GET' });

        if (response.ok) {
            return new Response(JSON.stringify({ message: 'URL submitted successfully!' }), { status: 200 });
        } else {
            return new Response(JSON.stringify({ message: 'Failed to submit URL.' }), { status: 400 });
        }
    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ message: 'Server error' }), { status: 500 });
    }
}
