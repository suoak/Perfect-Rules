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

  if (unitedStatesNodes.length === 0) {
    throw new Error("订阅中没有可用于 AI 固定出口的美国节点");
  }

  var stableAIProxy = unitedStatesNodes.filter(function(name) {
    return /^US006$/i.test(name);
  })[0] || unitedStatesNodes[0];
  var fixedAIChoices = [stableAIProxy].concat(
    unitedStatesNodes.filter(function(name) { return name !== stableAIProxy; })
  );
  var automaticChoices = ["🔒 AI 固定出口"].concat(
    proxyNames.filter(function(name) { return unitedStatesNodes.indexOf(name) === -1; })
  );

  var regionGroups = [
    {
      "name": "🇺🇸 美国节点",
      "type": "select",
      "proxies": ["🔒 AI 固定出口"]
    },
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
      "+.ruijie.com",
      "geosite:feishu",
      "geosite:lark",
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
      "+.ruijie.com": ["system"],
      "geosite:feishu": ["system"],
      "geosite:lark": ["system"],
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
      "+.ruijie.com",
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
      "proxies": ["🔒 AI 固定出口"]
    },
    {
      "name": "🔒 AI 固定出口",
      "type": "select",
      "proxies": fixedAIChoices
    },
    {
      "name": "💻 开发服务",
      "type": "select",
      "proxies": ["♻️ 自动选择"].concat(regionNames)
    },
    {
      "name": "🛡️ 广告拦截",
      "type": "select",
      "proxies": ["REJECT", "DIRECT"]
    },
    urlTestGroup("♻️ 自动选择", automaticChoices)
  ].concat(regionGroups);

  config["rule-providers"] = {
    "ad-allowlist": {
      "type": "http",
      "behavior": "domain",
      "format": "yaml",
      "url": "https://raw.githubusercontent.com/suoak/Perfect-Rules/main/rules/ad-allowlist.yaml",
      "path": "./ruleset/ad-allowlist.yaml",
      "interval": 300,
      "proxy": "DIRECT",
      "size-limit": 65536
    },
    "anti-ad": {
      "type": "http",
      "behavior": "domain",
      "format": "mrs",
      "url": "https://anti-ad.net/mihomo.mrs",
      "path": "./ruleset/anti-ad.mrs",
      "interval": 86400,
      "proxy": "DIRECT",
      "size-limit": 5242880
    }
  };

  config["rules"] = [
    "PROCESS-NAME-WILDCARD,*Feishu*,DIRECT",
    "PROCESS-NAME-WILDCARD,*Lark*,DIRECT",
    "DOMAIN-SUFFIX,ruijie.com.cn,DIRECT",
    "DOMAIN-SUFFIX,ruijie.com,DIRECT",
    "DOMAIN-SUFFIX,anycross.com,DIRECT",
    "DOMAIN-SUFFIX,baseopendev.com,DIRECT",
    "DOMAIN-SUFFIX,fei-shu.cn,DIRECT",
    "DOMAIN-SUFFIX,feishu.cn,DIRECT",
    "DOMAIN-SUFFIX,feishu.net,DIRECT",
    "DOMAIN-SUFFIX,feishuapp-cdn.net,DIRECT",
    "DOMAIN-SUFFIX,feishuapp.cn,DIRECT",
    "DOMAIN-SUFFIX,feishuapp.com,DIRECT",
    "DOMAIN-SUFFIX,feishucdn.com,DIRECT",
    "DOMAIN-SUFFIX,feishudoc.cn,DIRECT",
    "DOMAIN-SUFFIX,feishudoc.com,DIRECT",
    "DOMAIN-SUFFIX,feishuhuiyi.cn,DIRECT",
    "DOMAIN-SUFFIX,feishuhuiyi.com,DIRECT",
    "DOMAIN-SUFFIX,feishuimg.com,DIRECT",
    "DOMAIN-SUFFIX,feishukacdn.com,DIRECT",
    "DOMAIN-SUFFIX,feishumeetings.cn,DIRECT",
    "DOMAIN-SUFFIX,feishumeetings.com,DIRECT",
    "DOMAIN-SUFFIX,feishuoffice.cn,DIRECT",
    "DOMAIN-SUFFIX,feishuoffice.com,DIRECT",
    "DOMAIN-SUFFIX,feishupkg.com,DIRECT",
    "DOMAIN-SUFFIX,feishuvc.cn,DIRECT",
    "DOMAIN-SUFFIX,feishuvc.com,DIRECT",
    "DOMAIN-SUFFIX,getfeishu.cn,DIRECT",
    "DOMAIN-SUFFIX,getfeishu.com,DIRECT",
    "DOMAIN-SUFFIX,securityfeishu.cn,DIRECT",
    "DOMAIN-SUFFIX,securityfs.cn,DIRECT",
    "DOMAIN-SUFFIX,lark.cn,DIRECT",
    "DOMAIN-SUFFIX,larkcloud.com,DIRECT",
    "DOMAIN-SUFFIX,larkcloud.net,DIRECT",
    "DOMAIN-SUFFIX,larkfn.com,DIRECT",
    "DOMAIN-SUFFIX,larkmeetings.cn,DIRECT",
    "DOMAIN-SUFFIX,larkmeetings.com,DIRECT",
    "DOMAIN-SUFFIX,larkoffice.com,DIRECT",
    "DOMAIN-SUFFIX,larkofficeapp.com,DIRECT",
    "DOMAIN-SUFFIX,larkofficecdn.com,DIRECT",
    "DOMAIN-SUFFIX,larkofficeimg.com,DIRECT",
    "DOMAIN-SUFFIX,larkofficepkg.com,DIRECT",
    "DOMAIN-SUFFIX,larkrooms.cn,DIRECT",
    "DOMAIN-SUFFIX,larkrooms.com,DIRECT",
    "DOMAIN-SUFFIX,larksuite.com,DIRECT",
    "DOMAIN-SUFFIX,larksuitecdn.com,DIRECT",
    "DOMAIN-SUFFIX,larksuiteimg.com,DIRECT",
    "DOMAIN-SUFFIX,larkvc.com,DIRECT",
    "DOMAIN-SUFFIX,statuslarkoffice.com,DIRECT",
    "DOMAIN-SUFFIX,thelarkcloud.com,DIRECT",
    "DOMAIN,frontier-lark-lb-v3.lf.bytelb.net,DIRECT",
    "DOMAIN,lark-frontier.byteoversea.com,DIRECT",
    "DOMAIN,rtc-grpc.bytedance.com,DIRECT",
    "DOMAIN,rtc-grpc-hl.bytedance.com,DIRECT",
    "DOMAIN,lvcio-media-platform.bytedance.com,DIRECT",
    "DOMAIN,metrics-producer-proxy.bytedance.com,DIRECT",
    "DOMAIN,monitor.snssdk.com,DIRECT",
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
    "PROCESS-NAME-WILDCARD,*Grok*,🤖 国外 AI",
    "PROCESS-NAME-WILDCARD,*xAI*,🤖 国外 AI",
    "DOMAIN-SUFFIX,openai.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,chatgpt.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,oaistatic.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,oaiusercontent.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,oaistatsig.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,openaimerge.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,workoscdn.com,🤖 国外 AI",
    "DOMAIN,cdn.workos.com,🤖 国外 AI",
    "DOMAIN,forwarder.workos.com,🤖 国外 AI",
    "DOMAIN,setup.workos.com,🤖 国外 AI",
    "DOMAIN,workos.imgix.net,🤖 国外 AI",
    "DOMAIN,challenges.cloudflare.com,🤖 国外 AI",
    "DOMAIN,ct.sendgrid.net,🤖 国外 AI",
    "DOMAIN,js.stripe.com,🤖 国外 AI",
    "DOMAIN,rum.browser-intake-datadoghq.com,🤖 国外 AI",
    "DOMAIN,humb.apple.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,intercom.io,🤖 国外 AI",
    "DOMAIN-SUFFIX,intercomcdn.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,anthropic.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,claude.ai,🤖 国外 AI",
    "DOMAIN-SUFFIX,claude.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,claudeusercontent.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,sentry.io,🤖 国外 AI",
    "DOMAIN,gemini.google.com,🤖 国外 AI",
    "DOMAIN,aistudio.google.com,🤖 国外 AI",
    "DOMAIN,ai.google.dev,🤖 国外 AI",
    "DOMAIN,accounts.google.com,🤖 国外 AI",
    "DOMAIN,oauth2.googleapis.com,🤖 国外 AI",
    "DOMAIN,generativelanguage.googleapis.com,🤖 国外 AI",
    "DOMAIN,aiplatform.googleapis.com,🤖 国外 AI",
    "DOMAIN,cloudaicompanion.googleapis.com,🤖 国外 AI",
    "DOMAIN,cloudcode-pa.googleapis.com,🤖 国外 AI",
    "DOMAIN,serviceusage.googleapis.com,🤖 国外 AI",
    "DOMAIN,cloudresourcemanager.googleapis.com,🤖 国外 AI",
    "DOMAIN,people.googleapis.com,🤖 国外 AI",
    "DOMAIN,firebaselogging-pa.googleapis.com,🤖 国外 AI",
    "DOMAIN,feedback-pa.googleapis.com,🤖 国外 AI",
    "DOMAIN,apihub.googleapis.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,gstatic.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,googleusercontent.com,🤖 国外 AI",
    "GEOSITE,google,🤖 国外 AI",
    "DOMAIN-SUFFIX,grok.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,x.ai,🤖 国外 AI",
    "DOMAIN-SUFFIX,x.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,twitter.com,🤖 国外 AI",
    "DOMAIN-SUFFIX,twimg.com,🤖 国外 AI",
    "DOMAIN,api.ipify.org,🤖 国外 AI",
    "GEOSITE,category-ai-!cn,🤖 国外 AI",
    "IP-CIDR,102.37.57.54/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,13.71.25.29/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,135.220.40.201/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,172.203.39.49/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,172.207.173.200/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,172.214.226.198/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,191.233.251.27/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,20.162.96.163/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,20.168.48.117/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,20.184.36.134/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,20.203.144.245/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,20.74.221.21/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,4.151.200.38/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,4.155.146.196/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,4.197.172.116/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,4.217.235.100/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,4.245.198.13/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,40.118.236.137/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,51.4.112.173/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,52.143.181.161/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,68.155.152.41/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,72.146.20.246/32,🤖 国外 AI,no-resolve",
    "IP-CIDR,74.248.148.7/32,🤖 国外 AI,no-resolve",
    "GEOSITE,github,💻 开发服务",
    "GEOSITE,gitlab,💻 开发服务",
    "DOMAIN-SUFFIX,docker.com,💻 开发服务",
    "DOMAIN-SUFFIX,docker.io,💻 开发服务",
    "DOMAIN-SUFFIX,npmjs.com,💻 开发服务",
    "DOMAIN-SUFFIX,npmjs.org,💻 开发服务",
    "DOMAIN-SUFFIX,pypi.org,💻 开发服务",
    "DOMAIN-SUFFIX,pythonhosted.org,💻 开发服务",
    "DOMAIN-SUFFIX,jetbrains.com,💻 开发服务",
    "DOMAIN-SUFFIX,visualstudio.com,💻 开发服务",
    "SUB-RULE,(NETWORK,tcp),ad-filter",
    "SUB-RULE,(NETWORK,udp),ad-filter",
    "GEOSITE,cn,DIRECT",
    "GEOIP,cn,DIRECT,no-resolve",
    "MATCH,🚀 代理选择"
  ];

  config["sub-rules"] = {
    "ad-filter": [
      "RULE-SET,ad-allowlist,PASS",
      "RULE-SET,anti-ad,🛡️ 广告拦截",
      "MATCH,PASS"
    ]
  };

  return config;
}
