const assert = require("node:assert/strict");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const dgram = require("node:dgram");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { reservePorts } = require("./check-ai-ip");

const root = path.resolve(__dirname, "..");
const native = { skip: !process.env.MIHOMO_BIN };
const yaml = () => JSON.parse(cp.execFileSync("ruby", ["-e",
  "require 'yaml'; require 'json'; print JSON.generate(YAML.load_file(ARGV[0]))",
  path.join(root, "Clash/Clash_merge.yaml")], { encoding: "utf8" }));
function js(input) {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, "Clash/Clash_mi.js"), "utf8") + ";this.render=main;", context);
  return JSON.parse(JSON.stringify(context.render(input)));
}
const dummy = (name) => ({ name, type: "ss", server: "127.0.0.1", port: 1, cipher: "aes-128-gcm", password: "test" });
const render = (kind, input) => kind === "js" ? js(input) : { ...yaml(), ...input };
const aiPath = `/proxies/${encodeURIComponent("🔒 AI 固定出口")}`;

async function eventually(read, condition, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { const value = await read(); if (condition(value)) return value; } catch (_) { /* Core/provider startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(label);
}
async function withCore(build, run) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "perfect-rules-route-"));
  const ports = await reservePorts();
  const secret = crypto.randomBytes(16).toString("hex");
  const file = path.join(home, "config.json");
  // Keep real TUN, DNS and system routes untouched. Each test supplies local rules/providers.
  const write = (config) => fs.writeFileSync(file, JSON.stringify({
    "mixed-port": ports.proxyPort, "external-controller": `127.0.0.1:${ports.controllerPort}`,
    secret, "log-level": "silent", profile: { "store-selected": true },
    proxies: config.proxies || [], "proxy-providers": config["proxy-providers"] || {},
    "proxy-groups": config["proxy-groups"], "rule-providers": config["rule-providers"] || {},
    "sub-rules": config["sub-rules"] || {}, rules: config.rules || ["MATCH,🔒 AI 固定出口"]
  }));
  write(build(home));
  const core = cp.spawn(process.env.MIHOMO_BIN, ["-d", home, "-f", file], { stdio: "ignore" });
  let spawnError;
  core.on("error", (error) => { spawnError = error; });
  const api = async (url, method = "GET", body) => {
    const response = await fetch(`http://127.0.0.1:${ports.controllerPort}${url}`, {
      method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(2000)
    });
    assert(response.ok, `Controller ${method} ${url}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  try {
    await eventually(() => api("/version"), (value) => !!value.version, "Isolated core must start");
    await run({ home, ports, api, reload: async (config) => {
      write(config);
      await api("/configs", "PUT", { path: file });
    } });
  } finally {
    const done = new Promise((resolve) => {
      if (!core.pid || core.exitCode !== null || spawnError) return resolve();
      core.once("exit", resolve); core.once("error", resolve);
    });
    if (core.pid && core.exitCode === null) core.kill("SIGTERM");
    const timer = setTimeout(() => { if (core.pid && core.exitCode === null) core.kill("SIGKILL"); }, 2000);
    await done; clearTimeout(timer);
    fs.rmSync(home, { recursive: true, force: true });
  }
}
function groupsOnly(config) {
  return { proxies: config.proxies, "proxy-providers": config["proxy-providers"], "proxy-groups": config["proxy-groups"] };
}

for (const kind of ["js", "yaml"]) {
  test(`${kind}: saved AI choice survives reload; deleted choice rejects`, native, async () => {
    const config = () => groupsOnly(render(kind, { proxies: [dummy("US006"), dummy("JP001")] }));
    await withCore(config, async ({ api, reload }) => {
      assert.equal((await api(aiPath)).now, "REJECT");
      await api(aiPath, "PUT", { name: "US006" });
      await reload(config());
      assert.equal((await api(aiPath)).now, "US006");
      await reload(groupsOnly(render(kind, { proxies: [dummy("JP001")] })));
      const group = await api(aiPath);
      assert.equal(group.now, "REJECT");
      assert(group.all.includes("JP001"));
      await api(aiPath, "PUT", { name: "JP001" });
      assert.equal((await api(aiPath)).now, "JP001");
    });
  });

  test(`${kind}: provider-only nodes work, direct nodes are filtered, deleted choices reject`, native, async () => {
    await withCore((home) => {
      const provider = path.join(home, "subscription.json");
      fs.writeFileSync(provider, JSON.stringify({ proxies: [dummy("US006-IPV6"), dummy("JP001"), { name: "JP-direct", type: "direct" }] }));
      return groupsOnly(render(kind, { proxies: [], "proxy-providers": { subscription: { type: "file", path: provider } } }));
    }, async ({ home, api }) => {
      const group = await eventually(() => api(aiPath), (g) => g.all.includes("US006-IPV6"), "Provider nodes must populate AI exit");
      assert.equal(group.all[0], "REJECT");
      assert(!group.all.includes("JP-direct"));
      assert.deepEqual((await api(`/proxies/${encodeURIComponent("🇯🇵 日本节点")}`)).all, ["JP001"]);
      await api(aiPath, "PUT", { name: "US006-IPV6" });
      fs.writeFileSync(path.join(home, "subscription.json"), JSON.stringify({ proxies: [dummy("JP001")] }));
      await api("/providers/proxies/subscription", "PUT");
      await eventually(() => api(aiPath), (g) => g.now === "REJECT" && !g.all.includes("US006-IPV6"), "Provider refresh must reject removed selected node");
    });
  });
}

function requestThroughProxy(port, target) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: target, agent: false, headers: { Host: new URL(target).host } }, (response) => {
      let body = ""; response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.once("error", reject);
    request.setTimeout(3000, () => request.destroy(new Error("Local proxy request timed out")));
  });
}

test("Ad PASS resumes the original proxy route instead of forcing DIRECT", native, async () => {
  const sockets = new Set();
  const upstream = http.createServer();
  upstream.on("connect", (_, socket) => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
    socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied"));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const base = yaml();
    await withCore(() => ({
      proxies: [{ name: "ordinary", type: "http", server: "127.0.0.1", port: upstream.address().port }],
      "proxy-groups": base["proxy-groups"].filter((g) => g.name === "🛡️ 广告拦截"),
      "rule-providers": {
        "ad-allowlist": { type: "inline", behavior: "domain", payload: [] },
        "anti-ad": { type: "inline", behavior: "domain", payload: ["ads.audit.invalid"] }
      }, "sub-rules": base["sub-rules"], rules: ["SUB-RULE,(NETWORK,tcp),ad-filter", "MATCH,ordinary"]
    }), async ({ ports, api }) => {
      assert.equal((await requestThroughProxy(ports.proxyPort, "http://ads.audit.invalid/")).status, 502);
      await api(`/proxies/${encodeURIComponent("🛡️ 广告拦截")}`, "PUT", { name: "PASS" });
      assert.deepEqual(await requestThroughProxy(ports.proxyPort, "http://ads.audit.invalid/"), { status: 200, body: "proxied" });
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

async function readBytes(socket, size) {
  const { once } = require("node:events");
  while (true) {
    const data = socket.read(size);
    if (data) return data;
    if (socket.destroyed) throw new Error("SOCKS socket closed during handshake");
    await once(socket, "readable");
  }
}
async function withSocksUdp(proxyPort, destinationPort, run) {
  const { once } = require("node:events");
  const tcp = net.createConnection({ host: "127.0.0.1", port: proxyPort });
  const udp = dgram.createSocket("udp4");
  tcp.setTimeout(3000, () => tcp.destroy(new Error("SOCKS test timed out")));
  try {
    await once(tcp, "connect");
    await new Promise((resolve) => udp.bind(0, "127.0.0.1", resolve));
    tcp.write(Buffer.from([5, 1, 0]));
    assert.deepEqual(await readBytes(tcp, 2), Buffer.from([5, 0]));
    tcp.write(Buffer.from([5, 3, 0, 1, 0, 0, 0, 0, 0, 0]));
    const reply = await readBytes(tcp, 10);
    assert.equal(reply[1], 0); assert.equal(reply[3], 1);
    const packet = Buffer.concat([Buffer.from([0, 0, 0, 1, 127, 0, 0, 1, destinationPort >> 8, destinationPort & 255]), Buffer.from("audit")]);
    await new Promise((resolve, reject) => udp.send(packet, reply.readUInt16BE(8), "127.0.0.1", (error) => error ? reject(error) : resolve()));
    await run();
  } finally { tcp.destroy(); udp.close(); }
}

test("Unsupported AI UDP is rejected instead of falling through to a different exit", native, async () => {
  const receiver = dgram.createSocket("udp4");
  let received = 0;
  receiver.on("message", () => { received++; });
  await new Promise((resolve) => receiver.bind(0, "127.0.0.1", resolve));
  try {
    const base = yaml();
    const guards = base.rules.filter((rule) => rule.includes("RULE-SET,ai-services"));
    assert.equal(guards.length, 2);
    const config = {
      proxies: [{ name: "TCP-only", type: "http", server: "127.0.0.1", port: 1 }],
      "proxy-groups": base["proxy-groups"].filter((g) => ["🤖 国外 AI", "🔒 AI 固定出口"].includes(g.name)),
      "rule-providers": { "ai-services": { type: "inline", behavior: "classical", payload: ["IP-CIDR,127.0.0.1/32,no-resolve"] } },
      rules: [...guards, "MATCH,DIRECT"]
    };
    await withCore(() => config, async ({ ports, api, reload }) => {
      await api(aiPath, "PUT", { name: "TCP-only" });
      await withSocksUdp(ports.proxyPort, receiver.address().port, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(received, 0, "AI UDP must not reach the ordinary DIRECT fallback");
      });
      // Positive control: the same packet and destination reach the fallback without the guard.
      await reload({ ...config, rules: [guards[0], "MATCH,DIRECT"] });
      await withSocksUdp(ports.proxyPort, receiver.address().port, async () => {
        await eventually(async () => received, (count) => count > 0, "Control UDP packet must reach the local receiver");
      });
    });
  } finally { receiver.close(); }
});

test("Unconfigured manual monitoring fails explicitly; scheduled monitoring reports disabled", () => {
  const workflow = JSON.parse(cp.execFileSync("ruby", ["-e",
    "require 'yaml'; require 'json'; print JSON.generate(YAML.load_file(ARGV[0]))",
    path.join(root, ".github/workflows/monitor-ai.yml")], { encoding: "utf8" }));
  const steps = workflow.jobs.monitor.steps;
  const check = steps.find((step) => step.name === "Check monitor configuration").run;
  const report = steps.find((step) => step.name === "Report monitoring outcome").run;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "perfect-rules-monitor-settings-"));
  try {
    const output = path.join(home, "output");
    const env = { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: "workflow_dispatch",
      SUBSCRIPTION_URL: "", AI_PROXY_NAME: "JP001", AI_EXPECTED_IP: "", US006_EXPECTED_IP: "" };
    const manual = cp.spawnSync("bash", ["-e", "-c", check], { env, encoding: "utf8" });
    assert.equal(manual.status, 1);
    assert.match(manual.stdout, /no public IP was checked/);
    assert.match(fs.readFileSync(output, "utf8"), /configured=false/);
    assert.equal(cp.spawnSync("bash", ["-e", "-c", check], { env: { ...env, GITHUB_EVENT_NAME: "schedule" } }).status, 0);
    const summary = path.join(home, "summary");
    assert.equal(cp.spawnSync("bash", ["-e", "-c", report], { env: {
      PATH: process.env.PATH, CONFIGURED: "false", PROBE_OUTCOME: "skipped", CHANGED: "", GITHUB_STEP_SUMMARY: summary
    } }).status, 0);
    assert.match(fs.readFileSync(summary, "utf8"), /not configured.*No public IP was checked/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
