<script setup>
import { createError } from "h3";
import PlayerPage from "~/components/PlayerPage.vue";
import { getBaseHead } from "~/utils/head";

const { t, locale } = useI18n();
const route = useRoute();

const rawId = Array.isArray(route.params.id)
  ? route.params.id[0]
  : route.params.id;
const parsedId = rawId ? Number.parseInt(String(rawId), 10) : NaN;

if (!Number.isFinite(parsedId) || parsedId < 1) {
  throw createError({ statusCode: 404, statusMessage: "Song not found" });
}

const { data, error } = await useFetch(`/api/song/${parsedId}`, {
  server: true,
});

if (error.value || !data.value?.fileName) {
  throw createError({ statusCode: 404, statusMessage: "Song not found" });
}

const fileName = data.value.fileName;
const tmaCache = useState("tmaCache", () => ({}));
if (data.value.tma_metadata) {
  tmaCache.value[fileName] = data.value.tma_metadata;
}
const activeSong = useState("activeSong", () => null);
activeSong.value = {
  id: parsedId,
  fileName: fileName,
  title: formatSongTitle(fileName),
  artist: data.value.artist,
  tma_metadata: data.value.tma_metadata,
};

const rawFileParam = Array.isArray(route.params.songFileName)
  ? route.params.songFileName[0]
  : route.params.songFileName;
const decodedParam = rawFileParam ? safeDecode(String(rawFileParam)) : "";
const canonicalPath = `/song/${parsedId}/${encodeURIComponent(fileName)}`;

if (decodedParam && decodedParam !== fileName) {
  await navigateTo(canonicalPath, { redirectCode: 301 });
}

const baseTitle = t("app.title");
const displayTitle = formatSongTitle(fileName);
const pageTitle = displayTitle ? `${displayTitle} - ${baseTitle}` : baseTitle;
const description = displayTitle
  ? `Listen to ${displayTitle} (${fileName}) with ${baseTitle}.`
  : `Listen to tracker music with ${baseTitle}.`;

const requestUrl = useRequestURL();
const canonicalUrl = `${requestUrl.origin}${canonicalPath}`;

useHead(() => {
  const head = getBaseHead(locale.value);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    "name": displayTitle || fileName,
    "url": canonicalUrl,
    "audio": {
      "@type": "AudioObject",
      "name": fileName,
      "contentUrl": `${requestUrl.origin}/api/music/${encodeURIComponent(fileName)}`,
    },
  };
  return {
    ...head,
    link: [...(head.link || []), { rel: "canonical", href: canonicalUrl }],
    script: [
      ...(head.script || []),
      {
        type: "application/ld+json",
        innerHTML: JSON.stringify(structuredData),
      },
    ],
  };
});

useSeoMeta({
  title: pageTitle,
  description,
  ogTitle: pageTitle,
  ogDescription: description,
  ogType: "music.song",
  ogUrl: canonicalUrl,
  twitterCard: "summary",
});

function formatSongTitle(name) {
  if (!name || typeof name !== "string") return "";
  const withoutExt = name.replace(/\.[^.]+$/, "");
  const normalized = withoutExt.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || name;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}
</script>

<template>
  <PlayerPage />
</template>
