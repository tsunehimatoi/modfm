import { getRequestURL } from "h3";
import db from "../db";

export default defineEventHandler((event) => {
  const requestUrl = getRequestURL(event);
  const siteUrl = requestUrl.origin;

  // 查询所有 playable = 1 的歌曲
  const songs = db.prepare(
    "SELECT id, filename FROM songs WHERE playable = 1"
  ).all() as Array<{ id: number; filename: string }>;

  // 生成 XML 内容
  const urls: string[] = [];

  // 添加首页
  urls.push(`
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`);

  // 循环添加歌曲页面
  for (const song of songs) {
    const encodedName = encodeURIComponent(song.filename);
    const loc = `${siteUrl}/song/${song.id}/${encodedName}`;
    urls.push(`
  <url>
    <loc>${loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);
  }

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("")}
</urlset>`;

  setHeader(event, "Content-Type", "application/xml; charset=utf-8");
  return sitemapXml;
});
