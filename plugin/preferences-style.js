(function () {
  const { defaults, normalizeStyle, readStyle } = window.OtohaSubtitleStyle;
  const preferences = window.iina.preferences;
  const font = document.querySelector("#subtitle-font");
  const scale = document.querySelector("#subtitle-scale");
  const color = document.querySelector("#subtitle-color");
  const background = document.querySelector("#subtitle-background");
  const dimSource = document.querySelector("#subtitle-dim-source");
  const preview = document.querySelector(".style-preview");
  const output = document.querySelector("#subtitle-scale-value");
  const reset = document.querySelector("#subtitle-style-reset");
  const status = document.querySelector("#subtitle-style-status");
  const controls = [font, scale, color, background, dimSource];

  function current() {
    return normalizeStyle({font: font.value, scale: Number(scale.value) / 100, color: color.value,
      background: background.checked, dimSource: dimSource.checked});
  }
  function render() {
    const style = current();
    output.value = scale.value;
    preview.style.fontFamily = style.font;
    preview.style.setProperty("--otoha-subtitle-preview-scale", style.scale);
    preview.style.setProperty("--otoha-subtitle-preview-color", style.color);
    preview.classList.toggle("has-background", style.background);
    preview.classList.toggle("dims-source", style.dimSource);
  }
  function fill(style) {
    font.value = style.font; scale.value = Math.round(style.scale * 100); color.value = style.color;
    background.checked = style.background; dimSource.checked = style.dimSource;
    font.setCustomValidity(""); render();
  }
  function save() {
    if (!output.checkValidity()) { output.reportValidity(); return; }
    const name = font.value.trim();
    if (name && normalizeStyle({font: name}).font !== name) {
      font.setCustomValidity("字体名称不能包含逗号或控制字符，且不能超过 128 个字符。");
      font.reportValidity(); return;
    }
    const style = current();
    fill(style);
    preferences.set("subtitle_style", JSON.stringify(style));
    preferences.set("subtitle_font", style.font);
    preferences.set("subtitle_scale", Math.round(style.scale * 100));
    if (typeof preferences.sync === "function") preferences.sync();
    status.textContent = "已保存，返回播放窗口应用。";
  }
  for (const control of controls) {
    control.addEventListener("input", () => { font.setCustomValidity(""); render(); });
    control.addEventListener("change", save);
  }
  output.addEventListener("input", () => {
    if (!output.checkValidity()) return;
    scale.value = output.value;
    render();
  });
  output.addEventListener("change", save);
  reset.addEventListener("click", () => { fill(defaults); save(); });
  const values = {};
  Promise.all(["subtitle_style", "subtitle_font", "subtitle_scale"].map(key => new Promise(resolve => {
    preferences.get(key, value => { values[key] = value; resolve(); });
  }))).then(() => {
    fill(readStyle({get: key => values[key]}));
    for (const control of [...controls, output, reset]) control.disabled = false;
  });
})();
