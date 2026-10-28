const fs = require("fs");
const net = require("net");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourceUrl = "https://openai.com/chatgpt-voice.json";
const policy = "🤖 国外 AI";

function replaceRequired(content, pattern, replacement, label) {
  if (!pattern.test(content)) throw new Error(`Could not find ${label} Voice IP block`);
  return content.replace(pattern, replacement);
}

function prepareUpdates(data, read = (file) => fs.readFileSync(path.join(root, file), "utf8")) {
  const prefixes = Array.isArray(data.prefixes)
    ? data.prefixes.map((entry) => entry.ipv4Prefix).filter(Boolean) : [];
  if (prefixes.length === 0 || prefixes.some((prefix) => {
    if (typeof prefix !== "string") return true;
    const [ip, mask, extra] = prefix.split("/");
    return extra !== undefined || net.isIP(ip) !== 4 || !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(mask);
  })) throw new Error("OpenAI Voice list did not contain valid IPv4 prefixes");
  if (new Set(prefixes).size !== prefixes.length) throw new Error("Duplicate Voice IPv4 prefixes");
  if (typeof data.creationTime !== "string" || !Number.isFinite(Date.parse(data.creationTime))) {
    throw new Error("Invalid Voice snapshot date");
  }
  const snapshotDate = new Date(data.creationTime).toISOString().slice(0, 10);
  const jsPath = "Clash/Clash_mi.js";
  const yamlPath = "Clash/Clash_merge.yaml";
  const js = replaceRequired(read(jsPath),
    /(?:    "IP-CIDR,[^"\n]+,🤖 国外 AI,no-resolve",\n)+/,
    prefixes.map((ip) => `    "IP-CIDR,${ip},${policy},no-resolve",`).join("\n") + "\n", "Clash JS");
  const yaml = replaceRequired(read(yamlPath),
    /(?:  - IP-CIDR,[^\n]+,🤖 国外 AI,no-resolve\n)+/,
    prefixes.map((ip) => `  - IP-CIDR,${ip},${policy},no-resolve`).join("\n") + "\n", "Clash YAML");
  const v2ray = JSON.parse(read("V2rayN.json"));
  const aiRule = v2ray.find((rule) => rule.remarks && rule.remarks.includes("OpenAI"));
  if (!aiRule) throw new Error("Could not find V2rayN AI rule");
  aiRule.ip = prefixes;
  const readme = replaceRequired(read("README.md"),
    /ChatGPT Voice 的 \d+ 个官方 IPv4 地址/, `ChatGPT Voice 的 ${prefixes.length} 个官方 IPv4 地址`, "README count");
  const updatedReadme = replaceRequired(readme, /生成时间为 \d{4}-\d{2}-\d{2}/,
    `生成时间为 ${snapshotDate}`, "README date");
  // Prepare every output before writing, so malformed input or a missing block leaves files untouched.
  return { prefixes, snapshotDate, files: {
    [jsPath]: js, [yamlPath]: yaml,
    "V2rayN.json": `${JSON.stringify(v2ray, null, 2)}\n`, "README.md": updatedReadme
  } };
}

async function main() {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`OpenAI Voice list returned HTTP ${response.status}`);
  const result = prepareUpdates(await response.json());
  const changed = Object.entries(result.files).filter(([file, content]) =>
    fs.readFileSync(path.join(root, file), "utf8") !== content);
  if (process.argv.includes("--check")) {
    if (changed.length) throw new Error("Voice snapshot is outdated; run node scripts/update-openai-voice.js and commit the updates");
    console.log(`Voice snapshot is current: ${result.prefixes.length} IPv4 prefixes (${result.snapshotDate})`);
    return;
  }
  for (const [file, content] of changed) fs.writeFileSync(path.join(root, file), content);
  console.log(`Updated ${result.prefixes.length} OpenAI Voice IPv4 prefixes (${result.snapshotDate})`);
}

module.exports = { prepareUpdates };
if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
