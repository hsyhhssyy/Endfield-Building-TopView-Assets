(() => {
  const script = document.currentScript;
  if (!script) return;
  const configUrl = new URL(script.dataset.deploymentConfig || "deployment-mode.json", document.baseURI);
  const rewrite = async () => {
    let config;
    try {
      const response = await fetch(configUrl, {cache: "no-store"});
      if (!response.ok) return;
      config = await response.json();
    } catch (_) { return; }
    if (config.profile !== "endfield-large-file-deployment-v1" || config.mode !== "direct") return;
    const manifestUrl = new URL(config.releaseAssets || "release-assets.json", configUrl);
    const response = await fetch(manifestUrl, {cache: "no-store"});
    if (!response.ok) throw new Error("cannot load release asset manifest");
    const manifest = await response.json();
    const replacements = new Map();
    for (const asset of manifest.assets || []) {
      const delivery = asset.delivery || {};
      if (delivery.profile !== "endfield-large-file-delivery-v1") continue;
      const pages = delivery.githubPages || {};
      const kubernetes = delivery.kubernetes || {};
      if (pages.mode !== "release" || kubernetes.mode !== "direct") continue;
      replacements.set(new URL(pages.url, document.baseURI).href,
                       new URL(kubernetes.path, configUrl).href);
    }
    const update = (root) => {
      const anchors = root.matches && root.matches("a[href]") ? [root] : root.querySelectorAll?.("a[href]") || [];
      for (const anchor of anchors) {
        const replacement = replacements.get(anchor.href);
        if (replacement) {
          anchor.href = replacement;
          anchor.dataset.deliveryMode = "direct";
        }
      }
    };
    update(document);
    new MutationObserver(changes => changes.forEach(change => {
      if (change.type === "attributes") update(change.target);
      change.addedNodes.forEach(node => { if (node.nodeType === 1) update(node); });
    })).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["href"]
    });
    document.documentElement.dataset.largeFileDelivery = "direct";
  };
  rewrite().catch(error => console.error("large-file delivery switch failed", error));
})();
