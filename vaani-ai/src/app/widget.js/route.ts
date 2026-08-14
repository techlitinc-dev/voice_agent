import { NextResponse } from "next/server";

/**
 * GET /widget.js — embeddable web-chat widget script (docs/new-features/04 §3.3).
 * Usage on a customer site:
 *   <script src="https://app.vaani.ai/widget.js" data-workspace="acme-clinic"></script>
 * Injects a floating launcher + iframe pointing at /widget/<slug>.
 */
export function GET() {
  const js = `(function(){
  var s = document.currentScript;
  var slug = s && s.getAttribute("data-workspace");
  if (!slug) { console.error("vaani-widget: data-workspace missing"); return; }
  if (window.__vaaniWidget) return;
  window.__vaaniWidget = true;
  var base = window.location.protocol + "//" + window.location.host;

  var open = false;
  var btn = document.createElement("button");
  btn.id = "vaani-widget-launcher";
  btn.textContent = "💬";
  btn.setAttribute("aria-label", "Chat with us");
  btn.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:9999;width:56px;height:56px;border-radius:50%;border:none;background:#7c3aed;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.3);";
  document.body.appendChild(btn);

  var frame = document.createElement("iframe");
  frame.id = "vaani-widget-frame";
  frame.src = base + "/widget/" + encodeURIComponent(slug);
  frame.style.cssText = "position:fixed;bottom:88px;right:20px;z-index:9998;width:360px;height:600px;max-width:calc(100vw - 40px);border:none;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.3);display:none;background:#fff;";
  document.body.appendChild(frame);

  btn.addEventListener("click", function(){
    open = !open;
    frame.style.display = open ? "block" : "none";
    btn.textContent = open ? "✕" : "💬";
  });
})();`;
  return new NextResponse(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
