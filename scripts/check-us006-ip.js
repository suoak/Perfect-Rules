const childProcess = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const subscriptionUrl = process.env.SUBSCRIPTION_URL || "";
const expectedIp = (process.env.US006_EXPECTED_IP || "").trim();
const mihomoBin = process.env.MIHOMO_BIN || "mihomo";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForController(processHandle) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (processHandle.exitCode !== null) break;
    try {
      const response = await fetch("http://127.0.0.1:19090/proxies/US006-CHECK");
      if (response.ok) {
        const group = await response.json();
        assert(group.all && group.all.includes("US006"), "Subscription does not contain an exact US006 node");
        return;
      }
    } catch (_) {
      // The controller is still starting.
    }
    await sleep(500);
  }
  throw new Error("Mihomo did not expose a usable US006 proxy group within 30 seconds");
}

function writeOutput(changed) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  }
}

function mask(value) {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::add-mask::${value}`);
  }
}

async function main() {
  assert(subscriptionUrl.startsWith("https://"), "SUBSCRIPTION_URL secret must be an HTTPS URL");
  assert(net.isIP(expectedIp) !== 0, "US006_EXPECTED_IP secret must contain one IPv4 or IPv6 address");

  mask(subscriptionUrl);
  mask(expectedIp);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "us006-check-"));
  const configPath = path.join(temp, "config.json");
  const config = {
    "mixed-port": 17890,
    "external-controller": "127.0.0.1:19090",
    mode: "rule",
    "log-level": "warning",
    "allow-lan": false,
    ipv6: false,
    "proxy-providers": {
      subscription: {
        type: "http",
        url: subscriptionUrl,
        path: "./providers/subscription.yaml",
        interval: 3600
      }
    },
    "proxy-groups": [
      {
        name: "US006-CHECK",
        type: "select",
        use: ["subscription"],
        filter: "(?i)^US006$"
      }
    ],
    rules: ["MATCH,US006-CHECK"]
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const mihomo = childProcess.spawn(
    mihomoBin,
    ["-d", path.join(temp, "home"), "-f", configPath],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let logs = "";
  mihomo.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  mihomo.stderr.on("data", (chunk) => { logs += chunk.toString(); });

  try {
    await waitForController(mihomo);
    const observedIp = childProcess.execFileSync(
      "curl",
      [
        "--fail", "--silent", "--show-error", "--max-time", "20",
        "--proxy", "http://127.0.0.1:17890",
        "https://api.ipify.org"
      ],
      { encoding: "utf8" }
    ).trim();
    assert(net.isIP(observedIp) !== 0, "US006 returned an invalid public IP response");
    mask(observedIp);

    const changed = observedIp !== expectedIp;
    writeOutput(changed);
    console.log(changed ? "US006 public IP differs from the configured baseline" : "US006 public IP matches the configured baseline");
  } catch (error) {
    const safeLogs = logs.split(subscriptionUrl).join("[masked subscription URL]");
    throw new Error(`${error.message}\n${safeLogs.slice(-4000)}`);
  } finally {
    mihomo.kill("SIGTERM");
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
