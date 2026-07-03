# WASM 构建指南

## 概览

本项目对 libopenmpt 做了 C 源码级修改，增加了每通道波形提取功能（`waveform_processor`），需要重新编译为 WASM 才能在浏览器中使用。

## 目录结构

```
libopenmpt/          C/C++ 源码（已 patch waveform_processor）
  └── soundlib/
      ├── waveform_processor.h/c   ← 新增：环形缓冲区 + PeakSpeedTrigger
      ├── Sndfile.cpp/h            ← 已修改：集成波形处理器
      ├── Fastmix.cpp              ← 已修改：混音循环中馈送 PCM
      └── ...

chiptune/
  ├── chiptune3.worklet.js         ← AudioWorklet 处理器（调用 WASM 函数）
  └── pack.js                      ← 打包脚本：合并 WASM 胶水 + worklet

public/script/
  ├── libopenmpt.worklet.js        ← em++ 产出的纯 WASM 胶水文件
  └── chiptune3.worklet.js         ← pack.js 产出的最终浏览器加载文件
```

## 前置条件

- Emscripten SDK：正确安装 Emscripten，并且 `em++` 命令行工具在当前系统的 PATH 环境变量中可用
- Node.js ≥ 18

## 构建步骤

### Step 1：编译静态库

```bash
cd libopenmpt
make -j$(nproc)
```

产出：`.libs/libopenmpt.a`（LLVM bitcode 静态库）

> `make` 会自动使用 `em++` 作为编译器（configure 时已绑定了 Emscripten 环境的 C++ 编译器）。
>
> **注意：** `waveform_processor.c` 已经被 `Sndfile.cpp` 通过 `#include` 直接引入，**不要**单独编译成 `.o` 注入，否则会造成重复符号导致 WASM 崩溃。

### Step 2：链接生成 WASM 胶水文件

```bash
em++ -O3 \
  -s EXPORTED_FUNCTIONS='["_openmpt_module_create_from_memory","_openmpt_module_destroy","_openmpt_module_read_float_stereo","_openmpt_module_get_num_channels","_openmpt_module_get_channel_name","_openmpt_module_get_num_instruments","_openmpt_module_get_instrument_name","_openmpt_module_get_num_samples","_openmpt_module_get_sample_name","_openmpt_module_get_num_orders","_openmpt_module_get_order_name","_openmpt_module_get_order_pattern","_openmpt_module_get_num_patterns","_openmpt_module_get_pattern_name","_openmpt_module_get_pattern_num_rows","_openmpt_module_get_pattern_row_channel_command","_openmpt_module_get_num_subsongs","_openmpt_module_get_subsong_name","_openmpt_module_select_subsong","_openmpt_module_get_duration_seconds","_openmpt_module_get_position_seconds","_openmpt_module_set_position_seconds","_openmpt_module_set_position_order_row","_openmpt_module_get_current_order","_openmpt_module_get_current_pattern","_openmpt_module_get_current_row","_openmpt_module_get_current_channel_vu_left","_openmpt_module_get_current_channel_vu_right","_openmpt_module_set_repeat_count","_openmpt_module_set_render_param","_openmpt_module_ctl_set","_openmpt_module_get_metadata","_openmpt_module_get_metadata_keys","_openmpt_get_string","_openmpt_free_string","_openmpt_module_get_channel_waveform","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAP8","HEAPU8","HEAP16","HEAPF32","stackSave","stackAlloc","stackRestore","UTF8ToString","lengthBytesUTF8","stringToUTF8"]' \
  -s WASM=1 \
  -s ENVIRONMENT="web,worker" \
  -s SINGLE_FILE=1 \
  -s EXPORT_ES6=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=67108864 \
  -s MAXIMUM_MEMORY=134217728 \
  .libs/libopenmpt.a \
  -o ../public/script/libopenmpt.worklet.js
```

产出：`public/script/libopenmpt.worklet.js`（~1.6MB，ES6 模块 + 内嵌 WASM）

**关键参数：**
- `EXPORTED_RUNTIME_METHODS`：**必须**包含 `stackSave`、`stackAlloc`、`stackRestore`、`UTF8ToString`、`lengthBytesUTF8`、`stringToUTF8`。缺少任何一个，worklet 的 `getMeta()`/`getSong()` 就会静默抛出 `TypeError: libopenmpt.XXX is not a function`，meta 消息发不出来，UI 永远卡在 "正在加载歌曲..."
- `ALLOW_MEMORY_GROWTH=1` + `INITIAL_MEMORY=64MB` + `MAXIMUM_MEMORY=128MB`：防止大模块文件加载时 WASM 堆内存不足导致 `Aborted(OOM)`

### Step 3：合并打包

```bash
cd [项目根目录]
node chiptune/pack.js
```

产出：`public/script/chiptune3.worklet.js`（最终浏览器加载的单文件）

`pack.js` 做的事情：
1. 读取 `public/script/libopenmpt.worklet.js`（WASM 胶水）
2. 读取 `chiptune/chiptune3.worklet.js`（AudioWorklet 处理器）
3. 替换 import 语句，用 IIFE 包裹胶水代码隔离作用域
4. 合并为单文件写入 `public/script/chiptune3.worklet.js`

### Step 4（生产环境）：Nuxt 构建 + 输出

```bash
npx nuxi build && \
  cp public/script/chiptune3.worklet.js \
     public/script/libopenmpt.worklet.js \
     .output/public/script/
```

## 修改了 C 源码后如何重建（完整命令）

```bash
cd libopenmpt && make -j$(nproc) && \
  em++ -O3 \
    -s EXPORTED_FUNCTIONS='["_openmpt_module_create_from_memory","_openmpt_module_destroy","_openmpt_module_read_float_stereo","_openmpt_module_get_num_channels","_openmpt_module_get_channel_name","_openmpt_module_get_num_instruments","_openmpt_module_get_instrument_name","_openmpt_module_get_num_samples","_openmpt_module_get_sample_name","_openmpt_module_get_num_orders","_openmpt_module_get_order_name","_openmpt_module_get_order_pattern","_openmpt_module_get_num_patterns","_openmpt_module_get_pattern_name","_openmpt_module_get_pattern_num_rows","_openmpt_module_get_pattern_row_channel_command","_openmpt_module_get_num_subsongs","_openmpt_module_get_subsong_name","_openmpt_module_select_subsong","_openmpt_module_get_duration_seconds","_openmpt_module_get_position_seconds","_openmpt_module_set_position_seconds","_openmpt_module_set_position_order_row","_openmpt_module_get_current_order","_openmpt_module_get_current_pattern","_openmpt_module_get_current_row","_openmpt_module_get_current_channel_vu_left","_openmpt_module_get_current_channel_vu_right","_openmpt_module_set_repeat_count","_openmpt_module_set_render_param","_openmpt_module_ctl_set","_openmpt_module_get_metadata","_openmpt_module_get_metadata_keys","_openmpt_get_string","_openmpt_free_string","_openmpt_module_get_channel_waveform","_malloc","_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["HEAP8","HEAPU8","HEAP16","HEAPF32","stackSave","stackAlloc","stackRestore","UTF8ToString","lengthBytesUTF8","stringToUTF8"]' \
    -s WASM=1 -s ENVIRONMENT="web,worker" -s SINGLE_FILE=1 -s EXPORT_ES6=1 \
    -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=67108864 -s MAXIMUM_MEMORY=134217728 \
    .libs/libopenmpt.a -o ../public/script/libopenmpt.worklet.js && \
  cd .. && node chiptune/pack.js && npx nuxi build && \
  cp public/script/chiptune3.worklet.js public/script/libopenmpt.worklet.js .output/public/script/
```

## 相关文件

| 文件 | 作用 |
|------|------|
| `libopenmpt/soundlib/waveform_processor.c` | 核心波形处理逻辑 |
| `libopenmpt/soundlib/Sndfile.cpp` | 集成 waveform_processor |
| `libopenmpt/soundlib/Fastmix.cpp` | 混音循环中馈送 PCM 到波形处理器 |
| `chiptune/chiptune3.worklet.js` | AudioWorklet，调用 WASM 获取波形 |
| `chiptune/pack.js` | 打包脚本 |
| `app/utils/player-app.ts` | 主线程接收波形数据，DummyAnalyser |
| `app/components/ChannelScopes.vue` | 通道示波器渲染 |
