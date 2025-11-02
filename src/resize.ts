export function enableColumnResizers(root: HTMLElement) {
  const setVar = (k: string, v: string) => root.style.setProperty(k, v);

  const attach = (selector: string, cssVar: string, dir: "left" | "right") => {
    const pane = root.querySelector<HTMLElement>(selector);
    if (!pane) return;

    const h = document.createElement("div");
    h.className = "aip-resize-handle";
    pane.appendChild(h);

    let startX = 0, startW = 0;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const newW = Math.max(220, dir === "left" ? startW + dx : startW - dx);
      setVar(cssVar, `${newW}px`);
      localStorage.setItem(cssVar, `${newW}px`);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    h.addEventListener("mousedown", (ev) => {
      const paneRect = pane.getBoundingClientRect();
      startX = ev.clientX;
      startW = paneRect.width;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  };

  // Restore previous widths
  const left = localStorage.getItem("--aip-col-left");
  const right = localStorage.getItem("--aip-col-right");
  if (left) root.style.setProperty("--aip-col-left", left);
  if (right) root.style.setProperty("--aip-col-right", right);

  attach(".aip-left", "--aip-col-left", "left");
  attach(".aip-right", "--aip-col-right", "right");
}







