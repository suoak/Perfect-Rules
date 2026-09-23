function main(config) {
  var proxies = Array.isArray(config["proxies"]) ? config["proxies"] : [];
  var proxyNames = proxies
    .filter(function(proxy) { return proxy && proxy.name; })
    .map(function(proxy) { return proxy.name; });

  if (proxyNames.length === 0) {
    throw new Error("订阅中没有可用节点");
  }

  function matching(pattern) {
    return proxyNames.filter(function(name) { return pattern.test(name); });
  }

  function urlTestGroup(name, nodes) {
    return {
      "name": name,
      "type": "url-test",
      "proxies": nodes,
      "url": "https://cp.cloudflare.com/generate_204",
      "interval": 600,
      "timeout": 5000,
      "tolerance": 50,
      "lazy": true,
      "expected-status": 204,
      "max-failed-times": 3
    };
  }

  var koreaNodes = matching(/^(?:KOR|KR|韩国|🇰🇷)/i);
  var singaporeNodes = matching(/^(?:SG|SGP|新加坡|狮城|🇸🇬)/i);
  var unitedStatesNodes = matching(/^(?:US|USA|美国|🇺🇸)/i);
  var japanNodes = matching(/^(?:JP|JPN|日本|🇯🇵)/i);

  var regionGroups = [
    urlTestGroup("🇺🇸 美国节点", unitedStatesNodes),
    urlTestGroup("🇯🇵 日本节点", japanNodes),
    urlTestGroup("🇸🇬 新加坡节点", singaporeNodes),
    urlTestGroup("🇰🇷 韩国节点", koreaNodes)
  ].filter(function(group) { return group.proxies.length > 0; });

  var regionNames = regionGroups.map(function(group) { return group.name; });

  config["mixed-port"] = 7890;
  config["mode"] = "rule";
  config["log-level"] = "warning";
  config["allow-lan"] = false;
  config["ipv6"] = false;
  config["unified-delay"] = true;
  config["tcp-concurrent"] = true;
  config["find-process-mode"] = "always";
  config["keep-alive-interval"] = 30;
  config["keep-alive-idle"] = 30;
  config["disable-keep-alive"] = false;

  config["profile"] = {
    "store-selected": true,
    "store-fake-ip": true
  };

  config["tun"] = {
    "enable": true,
    "stack": "mixed",
    "auto-route": true,
    "auto-detect-interface": true,
    "strict-route": false,
    "dns-hijack": ["any:53", "tcp://any:53"],
    "route-exclude-address": [
      "10.0.0.0/8",
      "100.64.0.0/10",
      "127.0.0.0/8",
      "169.254.0.0/16",
      "172.16.0.0/12",
      "192.168.0.0/16"
    ]
  };

  config["dns"] = {
    "enable": true,
    "listen": "127.0.0.1:1053",
    "ipv6": false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": [
      "+.lan",
      "+.local",
      "+.localhost",
      "+.home.arpa",
      "+.ruijie.com.cn",
      "time.*.com",
      "time.*.gov",
      "pool.ntp.org",
      "+.push.apple.com",
      "mesu.apple.com",
      "swscan.apple.com",
      "captive.apple.com",
      "connectivitycheck.android.com",
      "www.msftconnecttest.com",
      "www.msftncsi.com"
    ],
    "default-nameserver": ["223.5.5.5", "119.29.29.29"],
    "nameserver": [
      "https://dns.alidns.com/dns-query",
      "https://doh.pub/dns-query"
    ],
    "nameserver-policy": {
      "geosite:private": ["system"],
      "+.ruijie.com.cn": ["system"],
      "geosite:cn": [
        "https://dns.alidns.com/dns-query",
        "https://doh.pub/dns-query"
      ],
      "geosite:geolocation-!cn": [
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/dns-query"
      ]
    },
    "proxy-server-nameserver": [
      "https://dns.alidns.com/dns-query",
      "https://doh.pub/dns-query"
    ],
    "direct-nameserver": ["system"],
    "direct-nameserver-follow-policy": false,
    "respect-rules": true
  };

  config["sniffer"] = {
    "enable": true,
    "parse-pure-ip": true,
    "force-dns-mapping": true,
    "override-destination": true,
    "sniff": {
      "HTTP": { "ports": [80, "8080-8880"] },
      "TLS": { "ports": [443, 8443] },
      "QUIC": { "ports": [443, 8443] }
    },
    "skip-domain": [
      "+.lan",
      "+.local",
      "+.ruijie.com.cn",
      "+.push.apple.com",
      "+.mijia.cloud"
    ]
  };

  config["proxy-groups"] = [
    {
      "name": "🚀 代理选择",
      "type": "select",
      "proxies": ["♻️ 自动选择"].concat(regionNames)
    },
    {
      "name": "🤖 国外 AI",
      "type": "select",
      "proxies": [
        "🇺🇸 美国节点",
        "🇯🇵 日本节点",
        "🇸🇬 新加坡节点",
        "🇰🇷 韩国节点",
        "♻️ 自动选择"
      ].filter(function(name) {
        return name === "♻️ 自动选择" || regionNames.indexOf(name) !== -1;
      })
    },
    urlTestGroup("♻️ 自动选择", proxyNames)
  ].concat(regionGroups);

  config["rule-providers"] = {};

  config["rules"] = [
    "PROCESS-NAME-WILDCARD,*Feishu*,DIRECT",
    "PROCESS-NAME-WILDCARD,*Lark*,DIRECT",
    "DOMAIN-SUFFIX,ruijie.com.cn,DIRECT",
    "GEOSITE,feishu,DIRECT",
    "GEOSITE,lark,DIRECT",
    "DOMAIN-SUFFIX,lan,DIRECT",
    "DOMAIN-SUFFIX,local,DIRECT",
    "DOMAIN-SUFFIX,localhost,DIRECT",
    "DOMAIN-SUFFIX,home.arpa,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",
    "GEOSITE,private,DIRECT",
    "GEOIP,private,DIRECT,no-resolve",
    "PROCESS-NAME-WILDCARD,*ChatGPT*,🤖 国外 AI",
    "PROCESS-NAME-WILDCARD,*Codex*,🤖 国外 AI",
    "PROCESS-NAME-WILDCARD,*Claude*,🤖 国外 AI",
    "PROCESS-NAME-WILDCARD,*Gemini*,🤖 国外 AI",
    "DOMAIN-SUFFIX,openai.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,chatgpt.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,oaistatic.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,oaiusercontent.com,🤖 国外 AI",
    "GEOSITE,category-ai-!cn,🤖 国外 AI",
    "GEOSITE,cn,DIRECT",
    "GEOIP,cn,DIRECT,no-resolve",
    "MATCH,🚀 代理选择"
  ];

  return config;
}
