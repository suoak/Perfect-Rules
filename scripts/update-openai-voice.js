const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourceUrl = "https://openai.com/chatgpt-voice.json";
const policy = "🤖 国外 AI";

function replaceRequired(content, pattern, replacement, label) {
  if (!pattern.test(content)) {
    throw new Error(`Could not find ${label} Voice IP block`);
  }
  return content.replace(pattern, replacement);
}

async function main() {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`OpenAI Voice list returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const prefixes = Array.isArray(data.prefixes)
    ? data.prefixes.map((entry) => entry.ipv4Prefix).filter(Boolean)
    : [];

  if (prefixes.length === 0 || prefixes.some((prefix) => !/^\d+(?:\.\d+){3}\/\d+$/.test(prefix))) {
    throw new Error("OpenAI Voice list did not contain valid IPv4 prefixes");
  }

  const jsPath = path.join(root, "Clash", "Clash_mi.js");
  const js = fs.readFileSync(jsPath, "utf8");
  const jsRules = prefixes
    .map((prefix) => `    "IP-CIDR,${prefix},${policy},no-resolve",`)
    .join("\n") + "\n";
  fs.writeFileSync(
    jsPath,
    replaceRequired(
      js,
      /(?:    "IP-CIDR,[^"\n]+,🤖 国外 AI,no-resolve",\n)+/,
      jsRules,
      "Clash JS"
    )
  );

  const yamlPath = path.join(root, "Clash", "Clash_merge.yaml");
  const yaml = fs.readFileSync(yamlPath, "utf8");
  const yamlRules = prefixes
    .map((prefix) => `  - IP-CIDR,${prefix},${policy},no-resolve`)
    .join("\n") + "\n";
  fs.writeFileSync(
    yamlPath,
    replaceRequired(
      yaml,
      /(?:  - IP-CIDR,[^\n]+,🤖 国外 AI,no-resolve\n)+/,
      yamlRules,
      "Clash YAML"
    )
  );

  const v2rayPath = path.join(root, "V2rayN.json");
  const v2ray = JSON.parse(fs.readFileSync(v2rayPath, "utf8"));
  const aiRule = v2ray.find((rule) => rule.remarks && rule.remarks.includes("OpenAI"));
  if (!aiRule) {
    throw new Error("Could not find V2rayN AI rule");
  }
  aiRule.ip = prefixes;
  fs.writeFileSync(v2rayPath, `${JSON.stringify(v2ray, null, 2)}\n`);

  const readmePath = path.join(root, "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  const snapshotDate = String(data.creationTime || "").slice(0, 10);
  if (snapshotDate) {
    fs.writeFileSync(
      readmePath,
      readme.replace(/生成时间为 \d{4}-\d{2}-\d{2}/, `生成时间为 ${snapshotDate}`)
    );
  }

  console.log(`Updated ${prefixes.length} OpenAI Voice IPv4 prefixes (${snapshotDate || "unknown date"})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
