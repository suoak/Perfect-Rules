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
  assert(net.isIP(expectedIp) === 4, "Set AI_EXPECTED_IP to the IPv4 address returned by api.ipify.org (legacy US006_EXPECTED_IP only applies to US006)");
  return { proxyName, expectedIp };
}

function exactFilter(name) {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

async function selectProxy(controller, secret, proxyName, processHandle, { timeoutMs = 30000, retryMs = 500 } = {}) {
  const url = `${controller}/proxies/AI-EXIT-CHECK`;
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  const deadline = Date.now() + timeoutMs;
  let nodeMissing = false;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null || !processHandle.pid) break;
    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(1000) });
    } catch (_) {
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      continue;
    }
    if (!response.ok) {
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      continue;
    }
    const group = await response.json();
    if (!Array.isArray(group.all) || !group.all.includes(proxyName)) {
      // Provider refresh is asynchronous; an initial REJECT fallback is not a final subscription result.
      nodeMissing = true;
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      continue;
    }
    const selected = await fetch(url, {
      method: "PUT", headers, body: JSON.stringify({ name: proxyName }), signal: AbortSignal.timeout(2000)
    });
    assert(selected.ok, "Could not select the configured AI node");
    const verified = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
    assert(verified.ok && (await verified.json()).now === proxyName, "AI node selection verification failed");
    return;
  }
  throw new Error(nodeMissing ? "Subscription does not contain the exact configured AI node after waiting for provider readiness" : "Mihomo did not expose a usable AI proxy group before the readiness timeout");
}

async function reservePorts() {
  const servers = [];
  try {
    // Keep both reservations open until distinct ports have been allocated.
    for (let index = 0; index < 2; index++) {
      const server = net.createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    }
    const [proxyPort, controllerPort] = servers.map((server) => server.address().port);
    return { proxyPort, controllerPort };
  } finally {
    await Promise.all(servers.filter((server) => server.listening)
      .map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

function probeConfig(subscriptionUrl, proxyName, secret, { proxyPort, controllerPort }) {
  return {
    "mixed-port": proxyPort, "bind-address": "127.0.0.1",
    "external-controller": `127.0.0.1:${controllerPort}`, secret,
    // Per-run proxy credentials also prevent an unrelated listener from being used silently.
    authentication: [`ai-monitor:${secret}`],
    mode: "rule", "log-level": "silent", "allow-lan": false, ipv6: false,
    "proxy-providers": { subscription: {
      type: "http", url: subscriptionUrl, path: "./providers/subscription.yaml", interval: 3600
    } },
    "proxy-groups": [{ name: "AI-EXIT-CHECK", type: "select", use: ["subscription"],
      filter: exactFilter(proxyName), "empty-fallback": "REJECT" }],
    rules: ["MATCH,AI-EXIT-CHECK"]
  };
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
  const ports = await reservePorts();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-exit-check-"));
  const secret = crypto.randomBytes(24).toString("hex");
  const configPath = path.join(temp, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(probeConfig(subscriptionUrl, proxyName, secret, ports)));
  const mihomo = childProcess.spawn(process.env.MIHOMO_BIN || "mihomo",
    ["-d", path.join(temp, "home"), "-f", configPath], { stdio: "ignore" });
  let spawnError;
  mihomo.on("error", (error) => { spawnError = error; });
  try {
    await selectProxy(`http://127.0.0.1:${ports.controllerPort}`, secret, proxyName, mihomo);
    if (spawnError) throw spawnError;
    const observedIp = childProcess.execFileSync("curl", [
      "--fail", "--silent", "--max-time", "20", "--noproxy", "",
      "--proxy", `http://127.0.0.1:${ports.proxyPort}`,
      "--proxy-user", `ai-monitor:${secret}`, "https://api.ipify.org"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    assert(net.isIP(observedIp) === 4, "AI node returned an invalid public IP response");
    mask(observedIp);
    const changed = observedIp !== expectedIp;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
    console.log(changed ? "AI public IP differs from the configured baseline" : "AI public IP matches the configured baseline");
  } catch (_) {
    // Never print raw core, curl or subscription errors: they may contain credentials or public IPs.
    throw new Error("AI exit probe failed; verify the node name, subscription, baseline and connectivity privately");
  } finally {
    const exited = new Promise((resolve) => {
      if (!mihomo.pid || mihomo.exitCode !== null || spawnError) return resolve();
      mihomo.once("exit", resolve);
      mihomo.once("error", resolve);
    });
    if (mihomo.pid && mihomo.exitCode === null) mihomo.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (mihomo.pid && mihomo.exitCode === null) mihomo.kill("SIGKILL");
    }, 2000);
    await exited;
    clearTimeout(timer);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { monitorSettings, exactFilter, selectProxy, reservePorts, probeConfig };
if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
