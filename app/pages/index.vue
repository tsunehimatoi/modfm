<script setup>
import PlayerPage from "~/components/PlayerPage.vue";
import { getBaseHead } from "~/utils/head";

const { t, locale } = useI18n();

const activeSong = useState("activeSong", () => null);
activeSong.value = null;

const requestUrl = useRequestURL();
const homeTitle = t("app.homeTitle") || t("app.title");
const description = t("app.description");

useHead(() => ({
  ...getBaseHead(locale.value),
  title: homeTitle,
}));

useSeoMeta({
  title: homeTitle,
  description: description,
  ogTitle: homeTitle,
  ogDescription: description,
  ogType: "website",
  ogUrl: requestUrl.href,
  twitterCard: "summary",
});

const route = useRoute();
const rawId = Array.isArray(route.query.id)
  ? route.query.id[0]
  : route.query.id;
const parsedId = rawId ? Number.parseInt(String(rawId), 10) : NaN;

if (Number.isFinite(parsedId) && parsedId > 0) {
  const { data } = await useFetch(`/api/song/${parsedId}`, { server: true });
  const fileName = data.value?.fileName;
  if (typeof fileName === "string" && fileName) {
    await navigateTo(`/song/${parsedId}/${encodeURIComponent(fileName)}`, {
      redirectCode: 301,
      replace: true,
    });
  }
}
</script>

<template>
  <PlayerPage />
</template>
