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

let providerJsConfig;

function loadJsConfig() {
  const names = [
    "US006", "US001", "US002", "US003", "US004", "US005",
    "JP001", "JP002", "JP003", "SG001", "KOR01",
    "US006-IPV6", "US005-IPV6", "DE001"
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
  function aiChoices(config) {
    return config["proxy-groups"].find((group) => group.name === "🔒 AI 固定出口").proxies;
  }
  for (const scenario of [
    ["JP001", "SG001"],
    ["US006-IPV6", "US005-IPV6", "JP001"],
    ["DE001"]
  ]) {
    const config = context.mainFn({ proxies: scenario.map((name) => ({ name, type: "ss" })) });
    same(Array.from(aiChoices(config)), ["REJECT", ...scenario], "AI candidates without exact US006");
  }
  const withDirect = context.mainFn({ proxies: [
    { name: "direct-node", type: "direct" }, { name: "JP001", type: "ss" }
  ] });
  same(Array.from(aiChoices(withDirect)), ["REJECT", "JP001"], "AI candidates excluding direct adapters");
  let rejectedEmpty = false;
  try {
    context.mainFn({ proxies: [] });
  } catch (error) {
    rejectedEmpty = /没有可用节点/.test(error.message);
  }
  assert(rejectedEmpty, "Clash JS must reject subscriptions without usable nodes");
  providerJsConfig = context.mainFn({ proxies: [], "proxy-providers": {
    subscription: { type: "inline", payload: proxies }
  } });
  const providerAI = providerJsConfig["proxy-groups"].find((group) => group.name === "🔒 AI 固定出口");
  assert(providerAI["include-all-providers"] && providerAI.proxies[0] === "REJECT", "Provider-only AI group must retain a reject guard");
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
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    assert(
      !credentialPatterns.some((pattern) => pattern.test(content)),
      `Possible subscription credential found in ${file}`
    );
  }
}

const nativeTemp = process.env.MIHOMO_BIN ? fs.mkdtempSync(path.join(os.tmpdir(), "perfect-rules-")) : null;

function nativeTest(config, label) {
  const binary = process.env.MIHOMO_BIN;
  if (!binary) return;

  const temp = nativeTemp;
  if (process.env.MIHOMO_GEODATA_DIR) {
    const home = path.join(temp, "home");
    fs.mkdirSync(home, { recursive: true });
    for (const name of ["Country.mmdb", "geosite.dat", "geoip.dat"]) {
      const source = path.join(process.env.MIHOMO_GEODATA_DIR, name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(home, name));
    }
  }
  const configPath = path.join(temp, `${label}.json`);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const result = childProcess.spawnSync(
    binary,
    ["-t", "-d", path.join(temp, "home"), "-f", configPath],
    { encoding: "utf8", timeout: 120000 }
  );
  assert(
    result.status === 0,
    `Mihomo native validation failed (${label}):\n${result.stdout || ""}${result.stderr || ""}`
  );
}

function main() {
  const jsConfig = loadJsConfig();
  const yamlConfig = readYaml("Clash/Clash_merge.yaml");
  const allowlist = readYaml("rules/ad-allowlist.yaml");
  const v2ray = JSON.parse(fs.readFileSync(path.join(root, "V2rayN.json"), "utf8"));

  same(jsConfig.rules, yamlConfig.rules, "rules");
  same(jsConfig.tun, yamlConfig.tun, "TUN settings");
  same(jsConfig.dns, yamlConfig.dns, "DNS settings");
  same(jsConfig.sniffer, yamlConfig.sniffer, "sniffer settings");
  same(jsConfig.profile, yamlConfig.profile, "profile settings");
  same(jsConfig["rule-providers"], yamlConfig["rule-providers"], "rule providers");
  same(jsConfig["sub-rules"], yamlConfig["sub-rules"], "sub-rules");

  const jsGroupNames = jsConfig["proxy-groups"].map((group) => group.name);
  const yamlGroupNames = yamlConfig["proxy-groups"].map((group) => group.name);
  same(jsGroupNames, yamlGroupNames, "proxy group names");

  for (const config of [jsConfig, yamlConfig]) {
    const ai = config["proxy-groups"].find((group) => group.name === "🔒 AI 固定出口");
    const us = config["proxy-groups"].find((group) => group.name === "🇺🇸 美国节点");
    const automatic = config["proxy-groups"].find((group) => group.name === "♻️ 自动选择");
    const ads = config["proxy-groups"].find((group) => group.name === "🛡️ 广告拦截");
    assert(ai && ai.type === "select", "AI exit must remain manually selected");
    assert(us && us.type === "select", "US region must remain manually selected");
    if (config === jsConfig) {
      assert(ai.proxies[0] === "REJECT", "AI exit must reject if a saved node disappears");
      same(Array.from(ai.proxies), ["REJECT", ...config.proxies.map((proxy) => proxy.name)], "All-region AI candidates");
      for (const name of ["JP001", "SG001", "KOR01", "DE001", "US006-IPV6", "US005-IPV6"]) {
        assert(ai.proxies.includes(name), `AI exit is missing ${name}`);
      }
      assert(us.proxies.every((name) => /^US/i.test(name)), "US region must contain only US nodes");
      same(Array.from(automatic.proxies), config.proxies.map((proxy) => proxy.name), "Automatic candidates");
    } else {
      assert(ai["include-all-proxies"] && !ai.filter && JSON.stringify(ai.proxies) === JSON.stringify(["REJECT"]), "Static AI exit must dynamically include all regions");
      assert(ai["exclude-type"] === "Direct|Compatible", "Static AI exit must exclude direct adapters");
      assert(us["include-all-proxies"] && us.filter === "(?i)^(US|USA|美国|🇺🇸)", "Static US region must filter US nodes");
      assert(automatic["include-all-proxies"] && !automatic["exclude-filter"] && !automatic.proxies, "Static automatic selection must include all nodes");
    }
    assert(ai["include-all-providers"], "AI exit must include proxy providers");
    assert(automatic["include-all-providers"], "Automatic selection must include proxy providers");
    assert(config.rules.indexOf("AND,((NETWORK,udp),(RULE-SET,ai-services)),REJECT") === config.rules.indexOf("RULE-SET,ai-services,🤖 国外 AI") + 1, "Unsupported AI UDP must be rejected before other exits");
    assert(config.rules.includes("GEOIP,cn,DIRECT") && !config.rules.includes("GEOIP,cn,DIRECT,no-resolve"), "China IP fallback must resolve unmatched domains");
    assert(config["rule-providers"]["ad-allowlist"].proxy === "📥 规则更新" && config["rule-providers"]["anti-ad"].proxy === "📥 规则更新", "Rule downloads must use the dedicated selection");
    assert(ads && JSON.stringify(ads.proxies) === JSON.stringify(["REJECT", "PASS"]), "Ad switch is invalid");
    assert(config["sub-rules"]["ad-filter"][0] === "RULE-SET,ad-allowlist,PASS", "Allowlist must run before anti-AD");
    assert(config["sub-rules"]["ad-filter"][1] === "RULE-SET,anti-ad,🛡️ 广告拦截", "anti-AD sub-rule is invalid");
    assert(!config.rules.some((rule) => /^DST-PORT,(15910|33443|34443),DIRECT$/.test(rule)), "UWS ports must not bypass routing for all destinations");
    for (const group of config["proxy-groups"]) {
      assert(group["empty-fallback"] === "REJECT", `Empty group must reject: ${group.name}`);
    }
    assert(config.rules.includes("PROCESS-NAME,UWS_Service.exe,DIRECT"), "UWS service direct rule is missing");
    assert(config.rules.includes("PROCESS-NAME,ClientDesktopService.exe,DIRECT"), "Ruijie desktop service direct rule is missing");
    for (const sag of ["112.111.6.185/32", "218.66.91.199/32", "183.250.189.235/32"]) {
      assert(config.rules.includes(`IP-CIDR,${sag},DIRECT,no-resolve`), `UWS SAG direct rule is missing: ${sag}`);
      assert(config.tun["route-exclude-address"].includes(sag), `UWS SAG TUN exclusion is missing: ${sag}`);
    }
  }

  assert(Array.isArray(allowlist.payload), "Ad allowlist payload must be an array");
  assert(new Set(allowlist.payload).size === allowlist.payload.length, "Ad allowlist contains duplicates");
  assert(
    allowlist.payload.every((domain) => typeof domain === "string" && !/[\s,]/.test(domain)),
    "Ad allowlist entries must be individual domains"
  );

  assert(!v2ray[v2ray.length - 1].port && JSON.stringify(v2ray[v2ray.length - 1].ip) === JSON.stringify(["0.0.0.0/0", "::/0"]), "V2rayN final rule must permit IPIfNonMatch DNS retry");
  const adRule = v2ray.find((rule) => rule.remarks && rule.remarks.startsWith("广告拦截"));
  assert(adRule && adRule.outboundTag === "block" && adRule.enabled, "V2rayN ad rule is invalid");
  assert(adRule.domain.includes("geosite:category-ads-all"), "V2rayN ad category is missing");
  assert(!v2ray.some((rule) => rule.port === "15910,33443,34443"), "V2rayN must not globally bypass UWS ports");
  const uwsAddressRule = v2ray.find((rule) => rule.remarks === "锐捷 U 空间 SAG 地址直连");
  assert(uwsAddressRule && uwsAddressRule.outboundTag === "direct" && uwsAddressRule.ip.length === 3, "V2rayN UWS address rule is invalid");

  const voiceIps = v2ray.find((rule) => rule.remarks && rule.remarks.includes("OpenAI")).ip;
  const clashVoiceIps = jsConfig["rule-providers"]["ai-services"].payload.filter((rule) => /^IP-CIDR,[^,]+,no-resolve$/.test(rule))
    .map((rule) => rule.split(",")[1]);
  same(clashVoiceIps, voiceIps, "Voice IPv4 lists");
  assert(new Set(voiceIps).size === voiceIps.length, "Duplicate Voice IP rules");
  validateReadmeLinks();
  validateTrackedContent();
  childProcess.execFileSync("git", ["diff", "--check"], { cwd: root, stdio: "inherit" });
  nativeTest(jsConfig, "js-full");
  nativeTest({ ...yamlConfig, proxies: jsConfig.proxies }, "yaml-merged-full");
  nativeTest({ ...yamlConfig, proxies: jsConfig.proxies.filter((proxy) => proxy.name === "JP001") }, "yaml-japan-only");
  nativeTest({ ...yamlConfig, proxies: [] }, "yaml-empty-subscription");
  nativeTest({ ...yamlConfig, proxies: [{ name: "direct-only", type: "direct" }] }, "yaml-direct-only");
  nativeTest(providerJsConfig, "js-provider-only");
  nativeTest({ ...yamlConfig, proxies: [], "proxy-providers": { subscription: { type: "inline", payload: jsConfig.proxies } } }, "yaml-provider-only");
  if (process.env.MIHOMO_BIN) console.log("Mihomo native validation passed: 7 complete configurations");
  else console.log("Mihomo native tests skipped: set MIHOMO_BIN to enable them");

  console.log(`Configuration validation passed: ${jsConfig.rules.length} Clash rules, ${jsConfig["rule-providers"]["ai-services"].payload.length} AI matchers, ${v2ray.length} V2rayN rules`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (nativeTemp) fs.rmSync(nativeTemp, { recursive: true, force: true });
}
