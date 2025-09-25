export async function onRequest(context) {
    const { url } = await context.request.json();
    const apiKey = context.env.INDEXNOW_API_KEY;
    const endpoint = `https://api.indexnow.org/indexnow?url=${encodeURIComponent(url)}&key=${apiKey}`;

    try {
        const res = await fetch(endpoint, { method: 'GET' });
        return new Response(JSON.stringify({ message: res.ok ? 'Submitted successfully' : 'Failed to submit' }), { status: res.ok ? 200 : 400 });
    } catch (err) {
        return new Response(JSON.stringify({ message: 'Server error' }), { status: 500 });
    }
}
