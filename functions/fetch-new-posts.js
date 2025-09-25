import { XMLParser } from "fast-xml-parser";

export async function onRequest() {
    const SITEMAP_URL = 'https://reviewindex.pages.dev/sitemap.xml?type=posts';
    try {
        const res = await fetch(SITEMAP_URL);
        const xmlText = await res.text();

        // Parse XML safely
        const parser = new XMLParser({ ignoreAttributes: false });
        const sitemap = parser.parse(xmlText);

        // Handle sitemap with multiple URLs
        let urls = [];
        if (sitemap.urlset && sitemap.urlset.url) {
            const items = Array.isArray(sitemap.urlset.url) ? sitemap.urlset.url : [sitemap.urlset.url];
            urls = items.map(u => ({
                loc: u.loc,
                lastmod: u.lastmod
            }));
        }

        const now = new Date();
        const recentUrls = urls.filter(u => u.lastmod && (now - new Date(u.lastmod)) / (1000 * 60 * 60) <= 48);

        return new Response(JSON.stringify(recentUrls), { status: 200 });
    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify([]), { status: 500 });
    }
}
