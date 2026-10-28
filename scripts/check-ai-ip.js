const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function monitorSettings(env) {
  const proxyName = (env.AI_PROXY_NAME || "US006").trim();
  const expectedIp = (env.AI_EXPECTED_IP || (proxyName === "US006" ? env.US006_EXPECTED_IP : "") || "").trim();
  assert(proxyName && !/[\r\n]/.test(proxyName), "AI_PROXY_NAME must be one exact node name");
  assert(net.isIP(expectedIp) !== 0, "Set AI_EXPECTED_IP to one public IP (legacy US006_EXPECTED_IP only applies to US006)");
  return { proxyName, expectedIp };
}

function exactFilter(name) {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

async function selectProxy(controller, secret, proxyName, processHandle) {
  const url = `${controller}/proxies/AI-EXIT-CHECK`;
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null || !processHandle.pid) break;
    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(1000) });
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    if (!response.ok) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    const group = await response.json();
    assert(group.all && group.all.includes(proxyName), "Subscription does not contain the exact configured AI node");
    const selected = await fetch(url, {
      method: "PUT", headers, body: JSON.stringify({ name: proxyName }), signal: AbortSignal.timeout(2000)
    });
    assert(selected.ok, "Could not select the configured AI node");
    const verified = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
    assert(verified.ok && (await verified.json()).now === proxyName, "AI node selection verification failed");
    return;
  }
  throw new Error("Mihomo did not expose a usable AI proxy group within 30 seconds");
}

function mask(value) {
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${value}`);
}

async function main() {
  const { proxyName, expectedIp } = monitorSettings(process.env);
  const subscriptionUrl = process.env.SUBSCRIPTION_URL || "";
  assert(subscriptionUrl.startsWith("https://"), "SUBSCRIPTION_URL must be an HTTPS URL");
  mask(subscriptionUrl);
  mask(expectedIp);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-exit-check-"));
  const secret = crypto.randomBytes(24).toString("hex");
  const configPath = path.join(temp, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    "mixed-port": 17890, "external-controller": "127.0.0.1:19090", secret,
    mode: "rule", "log-level": "silent", "allow-lan": false, ipv6: false,
    "proxy-providers": { subscription: {
      type: "http", url: subscriptionUrl, path: "./providers/subscription.yaml", interval: 3600
    } },
    "proxy-groups": [{ name: "AI-EXIT-CHECK", type: "select", use: ["subscription"],
      filter: exactFilter(proxyName), "empty-fallback": "REJECT" }],
    rules: ["MATCH,AI-EXIT-CHECK"]
  }));
  const mihomo = childProcess.spawn(process.env.MIHOMO_BIN || "mihomo",
    ["-d", path.join(temp, "home"), "-f", configPath], { stdio: "ignore" });
  let spawnError;
  mihomo.on("error", (error) => { spawnError = error; });
  try {
    await selectProxy("http://127.0.0.1:19090", secret, proxyName, mihomo);
    if (spawnError) throw spawnError;
    const observedIp = childProcess.execFileSync("curl", [
      "--fail", "--silent", "--max-time", "20", "--noproxy", "",
      "--proxy", "http://127.0.0.1:17890", "https://api.ipify.org"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    assert(net.isIP(observedIp) !== 0, "AI node returned an invalid public IP response");
    mask(observedIp);
    const normalized = (ip) => new URL(`http://${net.isIP(ip) === 6 ? `[${ip}]` : ip}`).hostname;
    const changed = normalized(observedIp) !== normalized(expectedIp);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
    console.log(changed ? "AI public IP differs from the configured baseline" : "AI public IP matches the configured baseline");
  } catch (_) {
    // Never print raw core, curl or subscription errors: they may contain credentials or public IPs.
    throw new Error("AI exit probe failed; verify the node name, subscription, baseline and connectivity privately");
  } finally {
    const exited = new Promise((resolve) => {
      if (mihomo.exitCode !== null || spawnError) return resolve();
      mihomo.once("exit", resolve);
      mihomo.once("error", resolve);
    });
    mihomo.kill("SIGTERM");
    const timer = setTimeout(() => mihomo.kill("SIGKILL"), 2000);
    await exited;
    clearTimeout(timer);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { monitorSettings, exactFilter, selectProxy };
if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
