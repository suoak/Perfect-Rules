const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { prepareUpdates } = require("./update-openai-voice");
const { monitorSettings, exactFilter, selectProxy } = require("./check-ai-ip");

const root = path.resolve(__dirname, "..");
const sample = { creationTime: "2026-10-27T22:28:21Z", prefixes: [{ ipv4Prefix: "192.0.2.1/32" }] };

test("Voice updates keep all formats and README count/date in sync", () => {
  const { files } = prepareUpdates(sample);
  assert.match(files["Clash/Clash_mi.js"], /IP-CIDR,192\.0\.2\.1\/32,🤖 国外 AI,no-resolve/);
  assert.match(files["Clash/Clash_merge.yaml"], /IP-CIDR,192\.0\.2\.1\/32,🤖 国外 AI,no-resolve/);
  assert.deepEqual(JSON.parse(files["V2rayN.json"]).find((r) => r.remarks?.includes("OpenAI")).ip, ["192.0.2.1/32"]);
  assert.match(files["README.md"], /ChatGPT Voice 的 1 个官方 IPv4 地址/);
  assert.match(files["README.md"], /生成时间为 2026-10-27/);
});

test("Voice malformed responses and missing blocks fail before any write", () => {
  const files = ["Clash/Clash_mi.js", "Clash/Clash_merge.yaml", "V2rayN.json", "README.md"];
  const before = files.map((file) => fs.readFileSync(path.join(root, file), "utf8"));
  for (const prefixes of [[], [{ ipv4Prefix: "999.0.0.1/32" }], [{ ipv4Prefix: "192.0.2.1/33" }],
    [{ ipv4Prefix: "192.0.2.1" }], [sample.prefixes[0], sample.prefixes[0]]]) {
    assert.throws(() => prepareUpdates({ ...sample, prefixes }));
  }
  assert.throws(() => prepareUpdates({ ...sample, creationTime: "bad-date" }));
  assert.throws(() => prepareUpdates(sample, (file) => file === "V2rayN.json" ? "[]" : fs.readFileSync(path.join(root, file), "utf8")));
  assert.deepEqual(files.map((file) => fs.readFileSync(path.join(root, file), "utf8")), before);
});

test("Monitor legacy baseline is restricted to US006; node names are literal", () => {
  assert.deepEqual(monitorSettings({ US006_EXPECTED_IP: "192.0.2.1" }), { proxyName: "US006", expectedIp: "192.0.2.1" });
  assert.throws(() => monitorSettings({ AI_PROXY_NAME: "JP001", US006_EXPECTED_IP: "192.0.2.1" }));
  assert.equal(monitorSettings({ AI_PROXY_NAME: "US006-IPV6", AI_EXPECTED_IP: "2001:db8::1" }).proxyName, "US006-IPV6");
  const name = "JP[01].(test)+?";
  const pattern = new RegExp(exactFilter(name));
  assert(pattern.test(name));
  assert(!pattern.test("JP0Xtest"));
  assert(!new RegExp(exactFilter("US006")).test("US006-IPV6"));
});

test("Monitor selects and verifies the target, rejects missing nodes", async () => {
  let now = "REJECT";
  let available = ["JP001"];
  const server = http.createServer(async (request, response) => {
    if (request.headers.authorization !== "Bearer test-secret") { response.writeHead(401).end(); return; }
    if (request.method === "PUT") {
      let body = "";
      for await (const chunk of request) body += chunk;
      now = JSON.parse(body).name;
      response.writeHead(204).end();
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ all: available, now }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const controller = `http://127.0.0.1:${server.address().port}`;
    await selectProxy(controller, "test-secret", "JP001", { pid: 1, exitCode: null });
    assert.equal(now, "JP001");
    available = ["REJECT"];
    await assert.rejects(selectProxy(controller, "test-secret", "US006", { pid: 1, exitCode: null }), /exact configured AI node/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Monitor startup errors finish without exposing subscription credentials", () => {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, "check-ai-ip.js")], {
    env: { ...process.env, AI_PROXY_NAME: "JP001", AI_EXPECTED_IP: "192.0.2.1",
      SUBSCRIPTION_URL: "https://subscription.invalid/private-token", MIHOMO_BIN: "/missing/perfect-rules-mihomo" },
    encoding: "utf8", timeout: 5000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AI exit probe failed/);
  assert(!result.stderr.includes("private-token"));
  assert(!result.stderr.includes("192.0.2.1"));
});

test("Mihomo runtime rejects empty AI and region groups", { skip: !process.env.MIHOMO_BIN }, async () => {
  const ruby = "require 'yaml'; require 'json'; print JSON.generate(YAML.load_file(ARGV[0]))";
  const yaml = JSON.parse(childProcess.execFileSync("ruby", ["-e", ruby, path.join(root, "Clash/Clash_merge.yaml")], { encoding: "utf8" }));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "perfect-rules-runtime-"));
  const secret = crypto.randomBytes(16).toString("hex");
  // Only the isolated controller runs. No TUN, DNS listener or system routing is enabled.
  const portServer = http.createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  try {
    for (const proxies of [[], [{ name: "direct-only", type: "direct" }], [{ name: "JP001", type: "ss", server: "127.0.0.1", port: 1, cipher: "aes-128-gcm", password: "test" }]]) {
      const file = path.join(temp, "config.json");
      fs.writeFileSync(file, JSON.stringify({
        "external-controller": `127.0.0.1:${port}`, secret, "log-level": "silent",
        proxies, "proxy-groups": yaml["proxy-groups"], rules: ["MATCH,🔒 AI 固定出口"]
      }));
      const core = childProcess.spawn(process.env.MIHOMO_BIN, ["-d", temp, "-f", file], { stdio: "ignore" });
      let spawnError;
      core.on("error", (error) => { spawnError = error; });
      try {
        let groups;
        for (let attempt = 0; attempt < 60; attempt++) {
          if (spawnError) throw spawnError;
          if (core.exitCode !== null) throw new Error("Isolated Mihomo exited before readiness");
          try {
            const response = await fetch(`http://127.0.0.1:${port}/proxies`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(500) });
            if (response.ok) { groups = (await response.json()).proxies; break; }
          } catch (_) { /* Wait for the isolated controller. */ }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert(groups, "Mihomo controller must become ready");
        for (const name of ["🔒 AI 固定出口", "🇺🇸 美国节点", "🇸🇬 新加坡节点", "🇰🇷 韩国节点"]) {
          const group = groups[name];
          assert(!group.all.includes("COMPATIBLE"), `${name} must never fall back to COMPATIBLE`);
          assert(!group.all.includes("DIRECT"), `${name} must never fall back to DIRECT`);
          if (!proxies.some((p) => p.type === "ss")) {
            assert.deepEqual(group.all, ["REJECT"]);
            assert.equal(group.now, "REJECT");
          }
        }
        if (proxies.some((p) => p.type === "ss")) {
          assert.deepEqual(groups["🔒 AI 固定出口"].all, ["JP001"]);
          assert.deepEqual(groups["🇺🇸 美国节点"].all, ["REJECT"]);
        }
      } finally {
        const exited = new Promise((resolve) => {
          if (core.exitCode !== null || spawnError) return resolve();
          core.once("exit", resolve);
          core.once("error", resolve);
        });
        core.kill("SIGTERM");
        const timer = setTimeout(() => core.kill("SIGKILL"), 2000);
        await exited;
        clearTimeout(timer);
      }
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
