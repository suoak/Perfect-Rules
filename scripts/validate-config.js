const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readYaml(relativePath) {
  const ruby = [
    "require 'yaml'",
    "require 'json'",
    "print JSON.generate(YAML.load_file(ARGV.fetch(0)))"
  ].join("; ");
  const output = childProcess.execFileSync(
    "ruby",
    ["-e", ruby, path.join(root, relativePath)],
    { encoding: "utf8" }
  );
  return JSON.parse(output);
}

function same(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} differs between Clash JS and YAML`
  );
}

function loadJsConfig() {
  const names = [
    "US006", "US001", "US002", "US003", "US004", "US005",
    "JP001", "JP002", "JP003", "SG001", "KOR01"
  ];
  const proxies = names.map((name) => ({
    name,
    type: "ss",
    server: "127.0.0.1",
    port: 1,
    cipher: "aes-128-gcm",
    password: "validation-only"
  }));
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    `${fs.readFileSync(path.join(root, "Clash", "Clash_mi.js"), "utf8")};this.mainFn=main`,
    context
  );
  return context.mainFn({ proxies });
}

function validateReadmeLinks() {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const links = [...readme.matchAll(/\]\((\.\/[^)]+)\)/g)].map((match) => match[1]);
  for (const link of links) {
    assert(fs.existsSync(path.join(root, link.slice(2))), `README link does not exist: ${link}`);
  }
}

function validateTrackedContent() {
  const files = childProcess.execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" }
  ).trim().split("\n").filter(Boolean);
  const credentialPatterns = [
    /token=[a-f0-9]{16,}/i,
    /sub\.suchen\.win/i,
    /sublink\.suchen\.win/i
  ];
  for (const file of files) {
    const fullPath = path.join(root, file);
    if (!fs.statSync(fullPath).isFile()) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    assert(
      !credentialPatterns.some((pattern) => pattern.test(content)),
      `Possible subscription credential found in ${file}`
    );
  }
}

function nativeTest(config) {
  const binary = process.env.MIHOMO_BIN;
  if (!binary) return;

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "perfect-rules-"));
  const configPath = path.join(temp, "config.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const result = childProcess.spawnSync(
    binary,
    ["-t", "-d", path.join(temp, "home"), "-f", configPath],
    { encoding: "utf8", timeout: 120000 }
  );
  fs.rmSync(temp, { recursive: true, force: true });
  assert(
    result.status === 0,
    `Mihomo native validation failed:\n${result.stdout || ""}${result.stderr || ""}`
  );
}

function main() {
  const jsConfig = loadJsConfig();
  const yamlConfig = readYaml("Clash/Clash_merge.yaml");
  const allowlist = readYaml("rules/ad-allowlist.yaml");
  const v2ray = JSON.parse(fs.readFileSync(path.join(root, "V2rayN.json"), "utf8"));

  same(jsConfig.rules, yamlConfig.rules, "rules");
  same(jsConfig["rule-providers"], yamlConfig["rule-providers"], "rule providers");
  same(jsConfig["sub-rules"], yamlConfig["sub-rules"], "sub-rules");

  const jsGroupNames = jsConfig["proxy-groups"].map((group) => group.name);
  const yamlGroupNames = yamlConfig["proxy-groups"].map((group) => group.name);
  same(jsGroupNames, yamlGroupNames, "proxy group names");

  for (const config of [jsConfig, yamlConfig]) {
    const ai = config["proxy-groups"].find((group) => group.name === "🔒 AI 固定出口");
    const ads = config["proxy-groups"].find((group) => group.name === "🛡️ 广告拦截");
    assert(ai && ai.proxies[0] === "US006", "US006 must remain the default AI node");
    assert(ads && JSON.stringify(ads.proxies) === JSON.stringify(["REJECT", "DIRECT"]), "Ad switch is invalid");
    assert(config["sub-rules"]["ad-filter"][0] === "RULE-SET,ad-allowlist,PASS", "Allowlist must run before anti-AD");
    assert(config["sub-rules"]["ad-filter"][1] === "RULE-SET,anti-ad,🛡️ 广告拦截", "anti-AD sub-rule is invalid");
  }

  assert(Array.isArray(allowlist.payload), "Ad allowlist payload must be an array");
  assert(new Set(allowlist.payload).size === allowlist.payload.length, "Ad allowlist contains duplicates");
  assert(
    allowlist.payload.every((domain) => typeof domain === "string" && !/[\s,]/.test(domain)),
    "Ad allowlist entries must be individual domains"
  );

  const adRule = v2ray.find((rule) => rule.remarks && rule.remarks.startsWith("广告拦截"));
  assert(adRule && adRule.outboundTag === "block" && adRule.enabled, "V2rayN ad rule is invalid");
  assert(adRule.domain.includes("geosite:category-ads-all"), "V2rayN ad category is missing");

  validateReadmeLinks();
  validateTrackedContent();
  childProcess.execFileSync("git", ["diff", "--check"], { cwd: root, stdio: "inherit" });
  nativeTest(jsConfig);

  console.log(`Configuration validation passed: ${jsConfig.rules.length} Clash rules, ${v2ray.length} V2rayN rules`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
