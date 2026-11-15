#!/usr/bin/env node
/**
 * 校验外部规则表（rules/custom.json）。
 *
 * 判据：
 *   1. 每条 id 合法且不与内置 R1–R22 冲突；
 *   2. pattern 能编译，长度 < 500；
 *   3. 编译后的规则必须能被 expect.match 命中、expect.clean 放行；
 *   4. 一条规则都没有 clean 用例时只告警，不算通过。
 *
 * 退出码：0 = 全部通过；1 = 有失败项。
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RULES, compileCustomRules } from "../lib/rules.js";

const file = process.argv[2] || fileURLToPath(new URL("../rules/custom.json", import.meta.url));
const ID = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;

function fail(msg) {
  console.log("FAIL  " + msg);
  failures += 1;
}
function ok(msg) {
  console.log("ok    " + msg);
}

let failures = 0;
let warnings = 0;

if (!existsSync(file)) {
  console.log("FAIL  规则文件不存在：" + file);
  process.exit(1);
}

let specs;
try {
  const data = JSON.parse(readFileSync(file, "utf8"));
  specs = Array.isArray(data) ? data : data && Array.isArray(data.rules) ? data.rules : null;
} catch (error) {
  console.log("FAIL  JSON 解析失败：" + (error && error.message ? error.message : String(error)));
  process.exit(1);
}
if (specs === null) {
  console.log("FAIL  顶层必须是数组，或 { rules: [...] }");
  process.exit(1);
}

console.log("规则文件：" + file);
console.log("条目数：" + specs.length + "，内置规则数：" + RULES.length + "\n");

const seen = new Set();
for (const [index, spec] of specs.entries()) {
  const label = "#" + index + " " + (spec && spec.id ? spec.id : "(no id)");
  if (spec === null || typeof spec !== "object") { fail(label + " 不是对象"); continue; }
  if (typeof spec.id !== "string" || !ID.test(spec.id)) { fail(label + " id 非法"); continue; }
  if (seen.has(spec.id)) { fail(label + " id 重复"); continue; }
  seen.add(spec.id);
  if (RULES.some((rule) => rule.id === spec.id)) { fail(label + " 与内置规则 id 冲突"); continue; }
  if (typeof spec.pattern !== "string" || spec.pattern.length === 0) { fail(label + " 缺少 pattern"); continue; }
  if (spec.pattern.length > 500) { fail(label + " pattern 超过 500 字符"); continue; }
  try {
    new RegExp(spec.pattern, typeof spec.flags === "string" ? spec.flags.replace(/[^imsu]/g, "") : "");
  } catch (error) {
    fail(label + " 正则无法编译：" + (error && error.message ? error.message : String(error)));
    continue;
  }

  const [rule] = compileCustomRules([spec]);
  if (rule === undefined) { fail(label + " 编译后被丢弃（检查 id/pattern/长度）"); continue; }

  const match = spec.expect && Array.isArray(spec.expect.match) ? spec.expect.match : [];
  const clean = spec.expect && Array.isArray(spec.expect.clean) ? spec.expect.clean : [];
  if (clean.length === 0) {
    console.log("warn  " + label + " 没有 expect.clean 反例，无法证明它不会误报");
    warnings += 1;
  }

  let bad = 0;
  for (const sample of match) {
    if (!rule.test(sample)) { console.log("     应命中但未命中：" + sample); bad += 1; }
  }
  for (const sample of clean) {
    if (rule.test(sample)) { console.log("     应放行但命中：" + sample); bad += 1; }
  }
  if (bad > 0) fail(label + " expect 断言失败 " + bad + " 条");
  else ok(label + " 通过（match " + match.length + " / clean " + clean.length + "）");
}

console.log("\n结果：" + (failures === 0 ? "PASS" : "FAIL " + failures + " 项") + (warnings > 0 ? "，告警 " + warnings + " 项" : ""));
process.exit(failures > 0 ? 1 : 0);
