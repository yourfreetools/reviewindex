export async function onRequest() {
    const SITEMAP_URL = 'https://reviewindex.pages.dev/sitemap.xml?type=posts';
    try {
        const res = await fetch(SITEMAP_URL);
        const xmlText = await res.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(xmlText, 'text/xml');

        const urls = Array.from(xml.querySelectorAll('url')).map(u => ({
            loc: u.querySelector('loc')?.textContent,
            lastmod: u.querySelector('lastmod')?.textContent
        }));

        const now = new Date();
        const recentUrls = urls.filter(u => u.lastmod && (now - new Date(u.lastmod)) / (1000*60*60) <= 48);

        return new Response(JSON.stringify(recentUrls), { status: 200 });
    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify([]), { status: 500 });
    }
}
