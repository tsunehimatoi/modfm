<script setup>
import { computed, ref, watch } from "vue";

const { t, locale } = useI18n();

const props = defineProps({
  isOpen: Boolean,
  closeModal: Function,
  meta: { type: Object, default: () => ({}) },
  fileName: { type: String, default: "" },
});

const tmaData = ref(null);
const loadingTma = ref(false);

watch(
  () => props.isOpen,
  async (open) => {
    if (open && props.fileName) {
      loadingTma.value = true;
      tmaData.value = null;
      try {
        const res = await $fetch("/api/songs", {
          query: { limit: 1, filenames: props.fileName }
        });
        if (res?.songs?.length > 0) {
          tmaData.value = res.songs[0].tma_metadata || null;
        }
      } catch (err) {
        console.error("Failed to load TMA metadata:", err);
      } finally {
        loadingTma.value = false;
      }
    }
  }
);

function hasRatings(tma) {
  return tma && tma.ratings && (tma.ratings.review_total > 0 || tma.ratings.comment_total > 0 || tma.ratings.review_rating > 0);
}

function hasArtists(tma) {
  if (!tma || !tma.artist_info) return false;
  const info = tma.artist_info;
  
  const hasValidArtist = info.artist && (
    Array.isArray(info.artist)
      ? info.artist.some(art => art && art.id > 0 && art.alias !== 'n/a')
      : (info.artist.id > 0 && info.artist.alias !== 'n/a')
  );

  const hasValidGuessed = info.guessed_artist && (
    Array.isArray(info.guessed_artist)
      ? info.guessed_artist.some(g => g && g.alias && g.alias !== 'n/a')
      : (info.guessed_artist.alias && info.guessed_artist.alias !== 'n/a')
  );

  return !!(hasValidArtist || hasValidGuessed);
}

function hasStats(tma) {
  if (!tma || !tma.raw_data) return false;
  try {
    const raw = JSON.parse(tma.raw_data);
    return raw.hits !== undefined || raw.favourites !== undefined;
  } catch (e) {
    return false;
  }
}

function getHits(tma) {
  try {
    const raw = JSON.parse(tma.raw_data);
    return raw.hits !== undefined ? parseInt(raw.hits, 10) : null;
  } catch (e) {
    return null;
  }
}

function getFavoured(tma) {
  try {
    const raw = JSON.parse(tma.raw_data);
    return raw.favourites?.favoured !== undefined ? parseInt(raw.favourites.favoured, 10) : null;
  } catch (e) {
    return null;
  }
}

function close() {
  props.closeModal?.();
}

const hasMeta = computed(() => {
  const m = props.meta;
  return m && (m.title || m.type || m.tracker || (m.channels && m.channels.length) || (m.instruments && m.instruments.length));
});

const formatDuration = (sec) => {
  if (!sec || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * 将 TMA 日期字符串（如 "Fri 1st Jul 2005"）转换为本地化日期
 * 在中文 locale 下会显示为 "2005年7月1日星期五"
 */
function formatTmaDate(dateStr) {
  if (!dateStr) return dateStr;
  // 尝试解析英文日期字符串，先去掉序数词后缀 (st/nd/rd/th)
  const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/i, "$1");
  const parsed = new Date(cleaned);
  if (isNaN(parsed.getTime())) return dateStr; // 解析失败则原样返回

  // 判断是否为中文类 locale
  const loc = locale.value || "en";
  const isZh = /^zh|^yue/i.test(loc);
  if (!isZh) return dateStr; // 非中文语言直接返回原始字符串

  // 映射 locale 到 Intl 支持的语言标签
  const intlLocale = loc === "yue" ? "zh-HK" : loc;
  return new Intl.DateTimeFormat(intlLocale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(parsed);
}

const metaRows = computed(() => {
  const m = props.meta;
  const tma = tmaData.value;
  const rows = [];

  // 1. 标题 (Title)：TMA 优先
  const titleVal = tma?.title || m.title;
  if (titleVal) {
    rows.push({ label: t("trackInfo.title"), value: titleVal });
  }

  // 2. 创作者 (Artist)
  const artistVal = m.artist;
  if (artistVal && (!tma || !hasArtists(tma))) {
    rows.push({ label: t("trackInfo.artist"), value: artistVal });
  }

  // 3. 音乐格式 (Type)：TMA 优先
  const typeVal = tma?.format || m.type;
  if (typeVal) {
    rows.push({ label: t("trackInfo.type"), value: typeVal });
  }

  // 4. Tracker 类型
  if (m.tracker) {
    rows.push({ label: t("trackInfo.tracker"), value: m.tracker });
  }

  // 5. 收录日期 (Date)：TMA 优先
  const dateVal = tma?.date || m.date;
  if (dateVal) {
    rows.push({ label: t("trackInfo.date"), value: formatTmaDate(dateVal) });
  }

  // 6. 时长与其它容器信息
  if (m.dur) {
    rows.push({ label: t("trackInfo.duration"), value: formatDuration(m.dur) });
  }
  if (m.container) {
    rows.push({ label: t("trackInfo.container"), value: m.container });
  }
  if (m.numSubsongs > 1) {
    rows.push({ label: t("trackInfo.subsongs"), value: String(m.numSubsongs) });
  }

  return rows;
});

const formattedMessage = computed(() => {
  if (!props.meta?.message) return "";
  return props.meta.message.replace(/(\r?\n\s*){2,}\r?\n/g, '\n\n').trim();
});

const hasNamedChannels = computed(() => {
  return props.meta?.channels?.some(ch => ch && ch.trim() !== "" && !/^CH\d+$/i.test(ch.trim()));
});

const hasInstruments = computed(() => {
  return props.meta?.instruments?.some(ins => ins && ins.trim() !== "");
});

const hasSamples = computed(() => {
  return props.meta?.samples?.some(smp => smp && smp.trim() !== "");
});

const hasOrders = computed(() => props.meta?.orders?.length > 0);
const hasSongs = computed(() => props.meta?.songs?.length > 1);

function handleBackdropClick(e) {
  if (e.target?.classList?.contains("ti-overlay")) {
    close();
  }
}
function handleKeydown(e) {
  if (e.key === "Escape") close();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ti-modal">
      <div
        v-if="isOpen"
        class="ti-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="t('trackInfo.modalTitle')"
        @click="handleBackdropClick"
        @keydown="handleKeydown"
      >
        <div class="ti-panel card">
          <header class="ti-header">
            <h2 class="ti-title">{{ t("trackInfo.modalTitle") }}</h2>
            <button
              class="ti-close btn-base"
              type="button"
              :aria-label="t('trackInfo.close')"
              @click="close"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <p class="ti-filename" :title="fileName">{{ fileName }}</p>

          <!-- 基本信息网格 (通栏展示) -->
          <div v-if="hasMeta && metaRows.length" class="meta-card-grid">
            <div v-for="row in metaRows" :key="row.label" class="meta-grid-item">
              <span class="meta-label">{{ row.label }}</span>
              <span class="meta-value">{{ row.value }}</span>
            </div>
          </div>

          <!-- 双栏主体容器 (无标签页) -->
          <div class="ti-panel-body-columns">
            <!-- 左栏：元数据区 -->
            <div class="meta-pane-wrapper">
              <!-- TMA 异步加载器 (统一风格的骨架卡片) -->
              <div v-if="loadingTma" class="tma-dashboard-card animate-pulse" :class="{ 'tma-full-width': !meta.message }">
                <div class="tma-dash-header">
                  <h3 class="tma-dash-title">
                    <svg class="tma-logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    <span class="skeleton-text-pill" style="width: 90px; height: 10px;"></span>
                  </h3>
                </div>
                <div class="tma-dash-body">
                  <div class="tma-dash-grid">
                    <div class="tma-grid-cell" v-for="n in 4" :key="n">
                      <span class="skeleton-text-pill" style="width: 50px; height: 8px; margin-bottom: 6px;"></span>
                      <span class="skeleton-text-pill" style="width: 80px; height: 12px;"></span>
                    </div>
                  </div>
                  <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
                    <span class="skeleton-text-pill" style="width: 40px; height: 8px;"></span>
                    <span class="skeleton-text-pill" style="width: 100%; height: 12px; border-radius: 6px;"></span>
                  </div>
                </div>
              </div>

              <!-- TMA 元数据仪表盘 -->
              <div v-else-if="tmaData && tmaData.tma_id" class="tma-dashboard-card" :class="{ 'tma-full-width': !meta.message }">
                <div class="tma-dash-header">
                  <h3 class="tma-dash-title">
                    <svg class="tma-logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    The Mod Archive
                  </h3>
                  <span v-if="tmaData.raw_data && JSON.parse(tmaData.raw_data).featured?.state" class="tma-featured-badge-modern">
                    ★ Featured 推荐
                  </span>
                </div>

                <div class="tma-dash-body scroll-container-panel">
                  <!-- 基本属性卡片网格 -->
                  <div class="tma-dash-grid">
                    <div class="tma-grid-cell" v-if="tmaData.tma_id">
                      <span class="cell-label">TMA 编号</span>
                      <a :href="'https://modarchive.org/module.php?' + tmaData.tma_id" target="_blank" class="cell-val link-styled font-mono">
                        #{{ tmaData.tma_id }}
                        <svg class="external-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/></svg>
                      </a>
                    </div>

                    <div class="tma-grid-cell" v-if="tmaData.genre_text && tmaData.genre_text !== 'n/a'">
                      <span class="cell-label">流派</span>
                      <span class="cell-val badge-pill text-accent">{{ tmaData.genre_text }}</span>
                    </div>

                    <div class="tma-grid-cell" v-if="tmaData.channels">
                      <span class="cell-label">通道</span>
                      <span class="cell-val">{{ tmaData.channels }} CH</span>
                    </div>

                    <div class="tma-grid-cell" v-if="tmaData.size">
                      <span class="cell-label">文件大小</span>
                      <span class="cell-val" :title="tmaData.bytes ? tmaData.bytes.toLocaleString() + ' 字节' : ''">
                        {{ tmaData.size }}
                      </span>
                    </div>
                  </div>

                  <!-- 艺术家行 -->
                  <div class="tma-artist-section" v-if="hasArtists(tmaData)">
                    <span class="section-label-small">创作者</span>
                    <div class="tma-artists-container">
                      <template v-if="tmaData.artist_info && tmaData.artist_info.artist">
                        <template v-if="Array.isArray(tmaData.artist_info.artist)">
                          <template v-for="art in tmaData.artist_info.artist" :key="art.id">
                            <a v-if="art && art.id > 0 && art.alias !== 'n/a'" :href="'https://modarchive.org/' + art.profile" target="_blank" class="tma-artist-badge-link">
                              <span class="artist-icon">@</span>
                              <span class="artist-name">{{ art.alias }}</span>
                            </a>
                          </template>
                        </template>
                        <template v-else-if="tmaData.artist_info.artist && tmaData.artist_info.artist.id > 0 && tmaData.artist_info.artist.alias !== 'n/a'">
                          <a :href="'https://modarchive.org/' + tmaData.artist_info.artist.profile" target="_blank" class="tma-artist-badge-link">
                            <span class="artist-icon">@</span>
                            <span class="artist-name">{{ tmaData.artist_info.artist.alias }}</span>
                          </a>
                        </template>
                      </template>

                      <template v-if="tmaData.artist_info && tmaData.artist_info.guessed_artist">
                        <template v-if="Array.isArray(tmaData.artist_info.guessed_artist)">
                          <template v-for="gArt in tmaData.artist_info.guessed_artist" :key="gArt.alias">
                            <span v-if="gArt && gArt.alias && gArt.alias !== 'n/a'" class="tma-artist-badge-guessed">
                              <span class="artist-icon">?</span>
                              <span class="artist-name">{{ gArt.alias }} (推测)</span>
                            </span>
                          </template>
                        </template>
                        <template v-else-if="tmaData.artist_info.guessed_artist && tmaData.artist_info.guessed_artist.alias && tmaData.artist_info.guessed_artist.alias !== 'n/a'">
                          <span class="tma-artist-badge-guessed">
                            <span class="artist-icon">?</span>
                            <span class="artist-name">{{ tmaData.artist_info.guessed_artist.alias }} (推测)</span>
                          </span>
                        </template>
                      </template>
                    </div>
                  </div>

                  <!-- 评分与讨论 -->
                  <div class="tma-rating-section" v-if="hasRatings(tmaData)">
                    <div class="rating-header-row">
                      <span class="section-label-small">社区评价</span>
                      <span v-if="tmaData.ratings.review_total > 0" class="rating-score-text">
                        ⭐ <strong class="score-highlight">{{ tmaData.ratings.review_rating }}</strong>/10
                      </span>
                    </div>
                    
                    <div v-if="tmaData.ratings.review_total > 0" class="rating-bar-container">
                      <div class="rating-bar-fill" :style="{ width: (tmaData.ratings.review_rating * 10) + '%' }"></div>
                    </div>
                    
                    <div class="rating-sub-info">
                      <span v-if="tmaData.ratings.review_total > 0">共 {{ tmaData.ratings.review_total }} 人参与打分</span>
                      <span v-if="tmaData.ratings.comment_total > 0" class="comment-count-pill">
                        💬 {{ tmaData.ratings.comment_total }} 条评论
                      </span>
                    </div>
                  </div>

                  <!-- 热度与收藏 -->
                  <div class="tma-stats-cards" v-if="hasStats(tmaData)">
                    <div class="stat-mini-card dl-card" v-if="getHits(tmaData) !== null">
                      <svg class="stat-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                      <div class="stat-text-group">
                        <span class="stat-val-small">{{ getHits(tmaData).toLocaleString() }}</span>
                        <span class="stat-lbl-small">下载量</span>
                      </div>
                    </div>
                    <div class="stat-mini-card fav-card" v-if="getFavoured(tmaData) !== null">
                      <svg class="stat-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                      <div class="stat-text-group">
                        <span class="stat-val-small">{{ getFavoured(tmaData) }}</span>
                        <span class="stat-lbl-small">官方收藏</span>
                      </div>
                    </div>
                  </div>

                  <!-- MD5 哈希代码框 -->
                  <div class="tma-hash-section" v-if="tmaData.hash">
                    <span class="section-label-small">MD5 哈希值</span>
                    <div class="hash-code-wrapper font-mono select-all select-text">
                      {{ tmaData.hash }}
                    </div>
                  </div>

                  <!-- 授权协议 -->
                  <div class="tma-license-section" v-if="tmaData.license && tmaData.license.title">
                    <div class="license-header">
                      <span class="license-icon">⚖️</span>
                      <a v-if="tmaData.license.legalurl" :href="tmaData.license.legalurl" target="_blank" class="license-title-link">
                        {{ tmaData.license.title }}
                      </a>
                      <span v-else class="license-title">{{ tmaData.license.title }}</span>
                    </div>
                    <p v-if="tmaData.license.description" class="license-desc-text">
                      {{ tmaData.license.description }}
                    </p>
                  </div>
                </div>
              </div>
              
              <!-- 歌曲留言消息 -->
              <div v-if="meta.message" class="message-dashboard-card">
                <div class="message-dash-header">
                  <h3 class="message-dash-title">
                    <svg class="message-logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    {{ t("trackInfo.message") }}
                  </h3>
                </div>
                <div class="message-dash-body scroll-container-panel">
                  <pre class="ti-message-text">{{ formattedMessage }}</pre>
                </div>
              </div>
            </div>

            <!-- 右栏：曲目结构及乐器采样区 -->
            <div class="ti-tabs-container-right">
              <!-- 2. 曲目结构 -->
              <div class="tab-pane structure-pane">
                <!-- 通道平铺 (仅渲染具有自定义名字的通道) -->
                <div v-if="hasNamedChannels" class="ti-section">
                  <h3 class="ti-section-title">{{ t("trackInfo.channels") }}</h3>
                  <div class="ti-channels-grid">
                    <template v-for="(ch, i) in meta.channels" :key="'ch'+i">
                      <span v-if="ch && ch.trim() !== '' && !/^CH\d+$/i.test(ch.trim())" class="ti-channel-pill">
                        <span class="ch-num">{{ (i + 1).toString().padStart(2, '0') }}</span>
                        <span class="ch-name">{{ ch }}</span>
                      </span>
                    </template>
                  </div>
                </div>

                <!-- 播放顺序 (矩阵排列的小表格方块) -->
                <div v-if="hasOrders" class="ti-section mt-4">
                  <h3 class="ti-section-title">{{ t("trackInfo.orders") }} ({{ meta.orders.length }})</h3>
                  <div class="ti-orders-grid-flat">
                    <div
                      v-for="(ord, i) in meta.orders"
                      :key="'ord'+i"
                      class="ti-order-pat-block"
                      :title="'Order: ' + i + ' | Pattern: ' + ord.pat"
                    >
                      <span class="pat-num-text">{{ ord.pat }}</span>
                    </div>
                  </div>
                </div>

                <!-- 子歌曲 -->
                <div v-if="hasSongs" class="ti-section mt-4">
                  <h3 class="ti-section-title">{{ t("trackInfo.subsongs") }}</h3>
                  <ul class="subsongs-styled-list">
                    <li v-for="(s, i) in meta.songs" :key="'song'+i" class="subsong-item">
                      <span class="subsong-dot"></span>
                      <span class="subsong-name">{{ s }}</span>
                    </li>
                  </ul>
                </div>
              </div>

              <!-- 3. 乐器与采样 (当至少有一个具有有效名称时才展示) -->
              <div class="tab-pane instruments-pane" v-if="hasInstruments || hasSamples">
                <div class="instruments-samples-grid">
                  <!-- 乐器列表 -->
                  <div class="ins-smp-column" v-if="hasInstruments">
                    <h3 class="ti-section-title">{{ t("trackInfo.instruments") }} ({{ meta.instruments.length }})</h3>
                    <div class="scroll-container-panel list-scroll-box">
                      <div class="flat-list">
                        <div v-for="(ins, i) in meta.instruments" :key="'ins'+i" class="list-row-item">
                          <span class="row-num-tag font-mono">{{ (i + 1).toString().padStart(2, '0') }}</span>
                          <span class="row-text-val" :title="ins">{{ ins }}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 采样列表 -->
                  <div class="ins-smp-column" v-if="hasSamples">
                    <h3 class="ti-section-title">{{ t("trackInfo.samples") }} ({{ meta.samples.length }})</h3>
                    <div class="scroll-container-panel list-scroll-box">
                      <div class="flat-list">
                        <div v-for="(smp, i) in meta.samples" :key="'smp'+i" class="list-row-item">
                          <span class="row-num-tag font-mono">{{ (i + 1).toString().padStart(2, '0') }}</span>
                          <span class="row-text-val" :title="smp">{{ smp }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 模态框底层遮罩 - 磨砂玻璃 */
.ti-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(8, 10, 15, 0.45);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
}

/* 模态框面板 (整体做纯流式垂直滚动，完全去 Tab) */
.ti-panel {
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  overflow-y: auto;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
  position: relative;
  background: color-mix(in srgb, var(--surface-2) 80%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 18px;
  box-shadow: 0 20px 50px -15px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.05);
  transition: transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1);
}

/* 头部样式 */
.ti-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-shrink: 0;
}

.ti-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text);
  background: linear-gradient(135deg, var(--text), color-mix(in srgb, var(--text) 70%, var(--accent)));
  -webkit-background-clip: text;
  background-clip: text;
}

.ti-close {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-3) 50%, transparent);
  border: 1px solid var(--border);
  color: var(--text-soft);
  cursor: pointer;
  transition: all 0.2s ease;
}
.ti-close:hover {
  background: var(--surface-hover);
  color: var(--text);
  transform: rotate(90deg);
}
.ti-close svg {
  width: 16px;
  height: 16px;
}

/* 文件名指示 */
.ti-filename {
  margin: 0;
  font-size: 0.76rem;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 0 0.15rem 0; /* 清爽无背景框副标题 */
  background: transparent;
  border: none;
  flex-shrink: 0;
  opacity: 0.85;
}

/* 自定义极细滚动条 */
.scroll-container-panel::-webkit-scrollbar,
.ti-panel::-webkit-scrollbar,
.ti-tabs-container-right::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.scroll-container-panel::-webkit-scrollbar-track,
.ti-panel::-webkit-scrollbar-track,
.ti-tabs-container-right::-webkit-scrollbar-track {
  background: transparent;
}
.scroll-container-panel::-webkit-scrollbar-thumb,
.ti-panel::-webkit-scrollbar-thumb,
.ti-tabs-container-right::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 99px;
}
.scroll-container-panel::-webkit-scrollbar-thumb:hover,
.ti-panel::-webkit-scrollbar-thumb:hover,
.ti-tabs-container-right::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}
.tab-pane > *,
.meta-pane-wrapper > * {
  flex-shrink: 0;
}

.ti-empty {
  color: var(--text-soft);
  font-size: 0.85rem;
  text-align: center;
  padding: 2.5rem 0;
}

/* 元数据网格 */
.meta-card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.6rem;
}
.meta-grid-item {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.5rem 0.75rem;
  background: color-mix(in srgb, var(--surface-3) 40%, transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.meta-label {
  font-size: 0.68rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.meta-value {
  font-size: 0.82rem;
  color: var(--text);
  font-weight: 500;
  word-break: break-all;
}

/* 骨架占位条 */
.skeleton-text-pill {
  display: inline-block;
  background: color-mix(in srgb, var(--border) 40%, transparent);
  border-radius: 4px;
}

/* TMA 与 Message 统一的集成模块设计 */
.tma-dashboard-card,
.message-dashboard-card {
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--surface-3) 40%, transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  margin-top: 0.25rem;
}

.tma-dash-header,
.message-dash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.85rem;
  background: color-mix(in srgb, var(--surface-3) 20%, transparent);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tma-dash-title,
.message-dash-title {
  margin: 0;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--text-soft);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.tma-logo-icon,
.message-logo-icon {
  width: 13px;
  height: 13px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.tma-dash-body,
.message-dash-body {
  padding: 0.85rem;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

/* 主体流式容器 */
.ti-panel-body-columns {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}

/* 元数据容器流式排列 */
.meta-pane-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}

/* 右栏容器流式向下堆叠 */
.ti-tabs-container-right {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}

.tma-featured-badge-modern {
  font-size: 0.64rem;
  font-weight: 800;
  background: linear-gradient(135deg, #f59e0b, #eab308);
  color: #1e1b4b;
  padding: 0.15rem 0.45rem;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 6px rgba(234, 179, 8, 0.25);
}

/* TMA 信息网格 */
.tma-dash-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.65rem;
}
.tma-grid-cell {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.cell-label, .section-label-small {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.cell-val {
  font-size: 0.78rem;
  color: var(--text);
  font-weight: 500;
}
.badge-pill {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  width: fit-content;
}
.badge-pill.text-accent {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}

.link-styled {
  color: var(--accent);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  transition: color 0.15s ease;
}
.link-styled:hover {
  color: var(--accent-light, #60a5fa);
  text-decoration: underline;
}
.external-icon {
  width: 10px;
  height: 10px;
}

/* 创作者卡片列表 */
.tma-artists-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.25rem;
}
.tma-artist-badge-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.55rem;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
  border-radius: 8px;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.74rem;
  font-weight: 600;
  transition: all 0.2s ease;
}
.tma-artist-badge-link:hover {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  transform: translateY(-1px);
}
.tma-artist-badge-guessed {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.55rem;
  background: color-mix(in srgb, var(--border) 60%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-soft);
  font-size: 0.7rem;
  font-style: italic;
}
.artist-icon {
  font-size: 0.65rem;
  opacity: 0.7;
}

/* 社区评分 */
.tma-rating-section {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.6rem 0.75rem;
  background: color-mix(in srgb, var(--surface-3) 40%, transparent);
  border-radius: 10px;
  border: 1px solid var(--border);
}
.rating-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.rating-score-text {
  font-size: 0.78rem;
  color: var(--text-soft);
}
.score-highlight {
  color: #f59e0b;
  font-size: 0.95rem;
}
.rating-bar-container {
  height: 6px;
  background: color-mix(in srgb, var(--border) 50%, transparent);
  border-radius: 99px;
  overflow: hidden;
  margin: 0.15rem 0;
}
.rating-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #f59e0b, #eab308);
  border-radius: 99px;
}
.rating-sub-info {
  display: flex;
  justify-content: space-between;
  font-size: 0.66rem;
  color: var(--text-muted);
}
.comment-count-pill {
  background: color-mix(in srgb, var(--text-soft) 8%, transparent);
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  color: var(--text-soft);
}

/* 热度模块 */
.tma-stats-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}
.stat-mini-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.65rem;
  border-radius: 10px;
  border: 1px solid var(--border);
}
.stat-mini-card.dl-card {
  background: color-mix(in srgb, var(--accent, #3b82f6) 6%, transparent);
  border-color: color-mix(in srgb, var(--accent, #3b82f6) 12%, var(--border));
  color: var(--accent);
}
.stat-mini-card.fav-card {
  background: color-mix(in srgb, #f43f5e 6%, transparent);
  border-color: color-mix(in srgb, #f43f5e 12%, var(--border));
  color: #f43f5e;
}
.stat-card-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.stat-text-group {
  display: flex;
  flex-direction: column;
}
.stat-val-small {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text);
}
.stat-lbl-small {
  font-size: 0.62rem;
  color: var(--text-muted);
}

/* Hash代码块 */
.tma-hash-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.hash-code-wrapper {
  font-size: 0.68rem;
  padding: 0.45rem 0.6rem;
  background: color-mix(in srgb, var(--surface-3) 90%, black);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-soft);
  word-break: break-all;
}

/* 授权协议 */
.tma-license-section {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding-top: 0.5rem;
  border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
}
.license-header {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.72rem;
  font-weight: 700;
}
.license-title-link {
  color: var(--text);
  text-decoration: none;
  transition: color 0.15s ease;
}
.license-title-link:hover {
  color: var(--accent);
  text-decoration: underline;
}
.license-title {
  color: var(--text);
}
.license-desc-text {
  margin: 0;
  font-size: 0.66rem;
  color: var(--text-muted);
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
  background: color-mix(in srgb, var(--text-muted) 5%, transparent);
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  border-left: 2px solid var(--border);
}

/* 播放顺序整齐矩阵网格 */
.ti-orders-grid-flat {
  display: grid;
  grid-template-columns: repeat(8, 1fr); /* 移动端每行对齐 8 列 */
  gap: 0.25rem;
  margin-top: 0.25rem;
}
.ti-order-pat-block {
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--surface-3) 60%, transparent);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-soft);
  cursor: default;
}

/* 留言区 */
.ti-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.ti-section-title {
  margin: 0;
  font-size: 0.7 flex;
  font-weight: 800;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.ti-message-text {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-soft);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  line-height: 1.4;
}

/* 通道网格 (只显示已命名通道) */
.ti-channels-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
}
@media (max-width: 400px) {
  .ti-channels-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
.ti-channel-pill {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
  padding: 0.25rem 0.4rem;
  border-radius: 8px;
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
}
.ch-num {
  color: var(--accent);
  font-weight: 700;
  opacity: 0.85;
}
.ch-name {
  color: var(--text-soft);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  font-weight: 500;
}

/* 子歌曲列表 */
.subsongs-styled-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.subsong-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-soft);
  padding: 0.15rem 0;
}
.subsong-dot {
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--accent);
}

/* 乐器与采样双栏网格 */
.instruments-samples-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}
@media (max-width: 480px) {
  .instruments-samples-grid {
    grid-template-columns: 1fr;
    gap: 0.95rem;
  }
}
.ins-smp-column {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

/* 彻底取消乐器/采样列表限高，使其在任何双端屏幕下都 100% 完整展示，不再出现独立滚动条 */
.list-scroll-box {
  max-height: none !important;
  overflow-y: visible !important;
}

.flat-list {
  display: flex;
  flex-direction: column;
}
.list-row-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  font-size: 0.72rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 30%, transparent);
}
.list-row-item:last-child {
  border-bottom: none;
}
.row-num-tag {
  color: var(--text-muted);
  font-size: 0.65rem;
  font-weight: 600;
  background: color-mix(in srgb, var(--border) 60%, transparent);
  padding: 0.05rem 0.25rem;
  border-radius: 4px;
}
.row-text-val {
  color: var(--text-soft);
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  flex: 1;
}

/* 模态框动画效果 */
.ti-modal-enter-active,
.ti-modal-leave-active {
  transition: opacity 0.25s ease;
}
.ti-modal-enter-from,
.ti-modal-leave-to {
  opacity: 0;
}
.ti-panel {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ti-modal-enter-from .ti-panel {
  transform: scale(0.93) translateY(12px);
}
.ti-modal-leave-to .ti-panel {
  transform: scale(0.93) translateY(12px);
  transition: transform 0.2s ease-in;
}

/* 桌面端分栏布局与排版优化 */
@media (min-width: 860px) {
  /* 面板本身变为垂直 Flex 容器，让顶部标题和基本信息自然排布，底部两栏填充 */
  .ti-panel {
    max-width: 980px;
    width: 90vw;
    max-height: 85vh;
    overflow: hidden; /* 大屏下锁定外壳滚动，依赖内部自滚动 */
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  
  /* 顶部文件名和基本信息网格占满宽度 */
  .ti-header,
  .ti-filename,
  .meta-card-grid {
    width: 100%;
    flex-shrink: 0;
  }
  
  .ti-filename {
    margin-bottom: -0.15rem;
  }

  /* 优化列数：大屏下基本信息通栏展示在最上方一行，横展为 5 列，紧凑且基本不留白 */
  .meta-card-grid {
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
  }
  
  /* 双栏主体包装容器在大屏下变为 CSS Grid 两栏：左2/3(1fr)，右1/3(300px) */
  .ti-panel-body-columns {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 1.5rem;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  
  /* 左侧元数据面板，占一整列，内部以 Grid 实现 TMA与Message 并列 */
  .meta-pane-wrapper {
    grid-column: 1;
    display: grid !important; /* 覆盖 mobile flex */
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    height: 100%;
    overflow: hidden; /* 大屏下禁止外层滚动，由两卡片内部容器自滚动 */
    padding-right: 0.75rem;
    border-right: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  }
  
  /* TMA 元数据仪表盘 与 Message 大屏下自适应撑满高度，完美对齐 */
  .tma-dashboard-card,
  .message-dashboard-card {
    height: 100%;
    max-height: none;
    margin-top: 0;
  }
  
  .tma-dashboard-card.tma-full-width {
    grid-column: 1 / -1;
  }
  
  /* 大屏下解封内容最大高度限制，由卡片容器提供 100% 高度支持 */
  .tma-dash-body,
  .message-dash-body {
    max-height: none;
    height: 100%;
  }
  
  /* 优化并列下的 TMA 网格：有留言时（不为full-width）改回 2 列以防拥挤，没有留言时（满宽）排成 4 列 */
  .tma-dashboard-card.tma-full-width .tma-dash-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  
  .tma-dashboard-card:not(.tma-full-width) .tma-dash-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  /* TMA 加载器 (骨架屏) 同样在大屏下跨满两列 */
  .tma-skeleton-container {
    grid-column: 1 / -1;
  }
  
  /* 右侧选项卡包装容器，占一整列 (1/3 宽)，包含 Tab 导航 and 子列表内容 */
  .ti-tabs-container-right {
    grid-column: 2;
    display: flex !important; /* 覆盖 mobile flex */
    flex-direction: column;
    gap: 0.95rem;
    height: 100%;
    min-height: 0;
    overflow-y: auto; /* 大屏下仅由右半侧这一整栏提供唯一的滚动支持，包容无高限的内容平铺 */
    padding-right: 0.25rem;
  }
  
  /* 大屏右侧各面板内容在整栏下连续铺陈，不需要任何自高度限制，由外层 ti-tabs-container-right 控制全局滚动 */
  .tab-pane.structure-pane,
  .tab-pane.instruments-pane {
    height: auto;
    overflow-y: visible;
    padding-right: 0;
  }
  
  /* 大屏下播放顺序每行展示 10 列，对齐呈完美的网格矩阵表格 */
  .ti-orders-grid-flat {
    grid-template-columns: repeat(10, 1fr);
  }
  
  /* 右侧的音轨通道（Channels）网格列数因为收窄到 300px 宽，平铺网格改回 4 列自适应 */
  .ti-channels-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  
  /* 乐器与采样的双栏大列表在大屏下改回垂直堆叠，因为 1/3 宽度不支持并排 */
  .instruments-samples-grid {
    grid-template-columns: 1fr;
    gap: 1.25rem;
    height: auto;
  }
}
</style>
