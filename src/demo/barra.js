// Barra del prototipo ("Ver como" y "Reiniciar demo"): solo en el modo demo, en el mismo lugar que estaba en el HTML.
document.querySelector("noscript").insertAdjacentHTML(
  "afterend",
  "<div class=\"demo\"><div class=\"in\">\n  <span><b>Prototipo</b> · Ver como:</span>\n  <div class=\"sw\" role=\"group\" aria-label=\"Rol\">\n    <button type=\"button\" data-role-view=\"cliente\" aria-pressed=\"true\">Cliente</button>\n    <button type=\"button\" data-role-view=\"barbero\" aria-pressed=\"false\">Prestador</button>\n    <button type=\"button\" data-role-view=\"admin\" aria-pressed=\"false\">Admin</button>\n  </div>\n  <button type=\"button\" class=\"rst\" id=\"reset\">Reiniciar demo</button>\n</div></div>\n",
);
