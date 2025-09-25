import { XMLParser } from 'fast-xml-parser';

export async function onRequest() {
    const SITEMAP_URL = 'https://reviewindex.pages.dev/sitemap.xml?type=posts';

    try {
        // Fetch the sitemap XML
        const res = await fetch(SITEMAP_URL);
        if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status}`);
        const xmlText = await res.text();

        // Parse the XML
        const parser = new XMLParser({ ignoreAttributes: false });
        const sitemap = parser.parse(xmlText);

        // Extract URLs and lastmod dates
        const urls = [];
        if (sitemap.urlset && sitemap.urlset.url) {
            const items = Array.isArray(sitemap.urlset.url) ? sitemap.urlset.url : [sitemap.urlset.url];
            items.forEach(u => {
                if (u.loc && u.lastmod) {
                    urls.push({ loc: u.loc, lastmod: u.lastmod });
                }
            });
        }

        // Filter URLs modified in the last 48 hours
        const now = new Date();
        const recentUrls = urls.filter(u => {
            const lastModDate = new Date(u.lastmod);
            return (now - lastModDate) / (1000 * 60 * 60) <= 48;
        });

        return new Response(JSON.stringify(recentUrls), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Error fetching or parsing sitemap:', err);
        return new Response(JSON.stringify({ error: 'Failed to fetch or parse sitemap' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
