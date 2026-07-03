import fs from 'fs';

// 1. 读取编译好的 libopenmpt 胶水代码
let libopenmptCode = fs.readFileSync('public/script/libopenmpt.worklet.js', 'utf8');

// 2. 去掉 export default Module;
libopenmptCode = libopenmptCode.replace("export default Module;", "");

// 3. 用 IIFE 闭包包裹 libopenmpt 胶水代码以隔离作用域
const wrappedLibOpenMPT = `
const initLibOpenMPT = (() => {
${libopenmptCode}
return Module;
})();
`;

// 4. 读取我们修改后的 chiptune3.worklet.js 源码
let workletCode = fs.readFileSync('chiptune/chiptune3.worklet.js', 'utf8');

// 5. 将 import 替换为指向我们隔离后的 initLibOpenMPT 闭包变量
workletCode = workletCode.replace("import libopenmptPromise from './libopenmpt.worklet.js'", "const libopenmptPromise = initLibOpenMPT;");

// 6. 拼接合并成单文件代码
const finalCode = `
// AudioWorklet Environment Polyfills
if (typeof performance === 'undefined') {
  globalThis.performance = { now: () => Date.now() };
}
if (typeof crypto === 'undefined') {
  globalThis.crypto = {
    getRandomValues: function(array) {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    }
  };
}

${wrappedLibOpenMPT}

${workletCode}
`;

// 7. 写入最终运行时 worklet 文件
fs.writeFileSync('public/script/chiptune3.worklet.js', finalCode, 'utf8');
console.log("Successfully packed chiptune3.worklet.js with IIFE isolation!");
