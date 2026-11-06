// Íconos propios (4/11, aprobados en la lámina): grilla de 24, trazo redondeado de 1,8 como el isotipo y un solo detalle
// verde (clase "a": trazo; "af": relleno; "af2": relleno suave; "df": relleno del color del texto). El trazo toma el color del
// texto (currentColor) y el verde sale de --ic-a (base.css), así se leen en cualquier rubro, en botones y en fondo oscuro.
// ic("agenda") devuelve el SVG listo para meter en el HTML (decorativo: el texto de al lado dice qué es).
// Lo que escriben las personas (mensajes, descripciones) y los textos planos (avisos, confirmaciones, push) no llevan íconos.
const ICONS = {
  "agenda": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"3\"/><path d=\"M3.5 10h17M8 3v4M16 3v4\"/><circle class=\"af\" cx=\"8\" cy=\"14.2\" r=\"1.1\"/><circle class=\"df\" cx=\"12\" cy=\"14.2\" r=\"1.1\"/><circle class=\"df\" cx=\"16\" cy=\"14.2\" r=\"1.1\"/><circle class=\"df\" cx=\"8\" cy=\"17.4\" r=\"1.1\"/><circle class=\"df\" cx=\"12\" cy=\"17.4\" r=\"1.1\"/>", // 📅
  "horarios": "<circle  cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5V12l3 2\"/><circle class=\"af\" cx=\"12\" cy=\"12\" r=\"1.25\"/>", // 🕒
  "finanzas": "<path d=\"M5.5 7.5 15 4.2a1.5 1.5 0 0 1 1.9 1L17.6 7.5\"/><rect x=\"3.5\" y=\"7.5\" width=\"17\" height=\"12.5\" rx=\"2.8\"/><path d=\"M20.5 11.5h-4a2.2 2.2 0 0 0 0 4.4h4\"/><circle class=\"af\" cx=\"16.6\" cy=\"13.7\" r=\"1.15\"/>", // 💰
  "productos": "<path d=\"M10 3.5h4M10.5 3.5v3l-2.2 2.2a2 2 0 0 0-.6 1.4V19a1.8 1.8 0 0 0 1.8 1.8h5a1.8 1.8 0 0 0 1.8-1.8v-8.9a2 2 0 0 0-.6-1.4l-2.2-2.2v-3\"/><path class=\"a\" d=\"M7.7 13.5h8.6\"/>", // 🧴
  "estadisticas": "<path d=\"M4 20h16M7 16.5v-4M12 16.5V9M17 16.5v-6\"/><circle class=\"af\" cx=\"17\" cy=\"6.3\" r=\"1.35\"/>", // 📊
  "clientes": "<circle  cx=\"9\" cy=\"8.2\" r=\"3.2\"/><path d=\"M3.5 19.5c.7-3.5 2.9-5.3 5.5-5.3s4.8 1.8 5.5 5.3\"/><circle class=\"a\" cx=\"16.6\" cy=\"9\" r=\"2.4\"/><path class=\"a\" d=\"M15.6 14.4c2.3.1 4 1.6 4.7 4.4\"/>", // 👥
  "trabajos": "<path d=\"M8.6 7.2 10 4.8h4l1.4 2.4\"/><rect x=\"3.5\" y=\"7.2\" width=\"17\" height=\"12.8\" rx=\"3\"/><circle  cx=\"12\" cy=\"13.4\" r=\"3.4\"/><circle class=\"af\" cx=\"17.4\" cy=\"10.2\" r=\"1\"/>", // 📸
  "ajustes": "<path d=\"M4 7.5h9.5M18.5 7.5H20M4 16.5h3.5M12.5 16.5H20\"/><circle  cx=\"16\" cy=\"7.5\" r=\"2.4\"/><circle class=\"a\" cx=\"10\" cy=\"16.5\" r=\"2.4\"/>", // ⚙️
  "campana": "<path d=\"M6 16.3v-5.1a6 6 0 0 1 12 0v5.1l1.6 2.1H4.4z\"/><path d=\"M10 20.5a2 2 0 0 0 4 0\"/><circle class=\"af\" cx=\"12\" cy=\"3.6\" r=\"1.2\"/>", // 🔔
  "misturnos": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"3\"/><path d=\"M3.5 10h17M8 3v4M16 3v4\"/><path class=\"a\" d=\"m9 15.2 2.1 2.1 4.1-4.2\"/>", // 📅
  "perfil": "<circle  cx=\"12\" cy=\"8.2\" r=\"3.8\"/><path d=\"M4.8 20c1.1-3.9 3.9-5.9 7.2-5.9s6.1 2 7.2 5.9\"/><circle class=\"af\" cx=\"17.7\" cy=\"5.2\" r=\"1.15\"/>", // 👤
  "salir": "<path d=\"M13.5 4H17a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 17 20h-3.5\"/><path class=\"a\" d=\"M14.5 12H4.5M8.5 8l-4 4 4 4\"/>", // ↪
  "admin": "<path d=\"M12 3.4 19 6v5.6c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9V6z\"/><path class=\"a\" d=\"m9 12 2.1 2.1 4-4.1\"/>", // 🛠️
  "negocio": "<path d=\"M4.5 9.5 6 4.5h12l1.5 5\"/><path d=\"M4.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0M5.8 12.3V20h12.4v-7.7\"/><path class=\"a\" d=\"M10 20v-4.2h4V20\"/>", // 🏪
  "instalar": "<rect x=\"6.5\" y=\"2.8\" width=\"11\" height=\"18.4\" rx=\"2.6\"/><path d=\"M10.5 18.2h3\"/><path class=\"a\" d=\"M12 7v6.2M9.6 10.9 12 13.3l2.4-2.4\"/>", // 📲
  "actualizar": "<path d=\"M19.4 13.4A7.6 7.6 0 0 1 5.6 16.6M4.6 10.6A7.6 7.6 0 0 1 18.4 7.4\"/><path d=\"M18.6 3.6v3.9h-3.9\"/><path class=\"a\" d=\"M5.4 20.4v-3.9h3.9\"/>", // ↻
  "barberia": "<path d=\"M7 3.8h10M7 20.2h10\"/><rect x=\"8.6\" y=\"3.8\" width=\"6.8\" height=\"16.4\" rx=\"3.4\"/><path class=\"a\" d=\"m8.8 9.6 6.4-2.8M8.8 14.1l6.4-2.8M8.8 18.6l6.4-2.8\"/>", // 💈
  "peluqueria": "<circle  cx=\"6.6\" cy=\"17.4\" r=\"2.9\"/><circle  cx=\"17.4\" cy=\"17.4\" r=\"2.9\"/><path d=\"M8.7 15.4 17.8 3.8M15.3 15.4 6.2 3.8\"/><circle class=\"af\" cx=\"12\" cy=\"11.2\" r=\"1.2\"/>", // ✂
  "masajes": "<path d=\"M5 19.5C5 11 10 5.6 19.5 4.5 18.5 14 13 19.5 5 19.5z\"/><path class=\"a\" d=\"M5 19.5 13.4 11.1M10 14.5h4M12 12.4V9\"/>", // 🌿
  "pestanas": "<path d=\"M2.8 13c2.4-3.4 5.5-5.2 9.2-5.2s6.8 1.8 9.2 5.2c-2.4 3.4-5.5 5.2-9.2 5.2S5.2 16.4 2.8 13z\"/><circle class=\"af\" cx=\"12\" cy=\"13\" r=\"2.5\"/><path d=\"M12 4.2v1.9M6.8 5.4l1 1.6M17.2 5.4l-1 1.6\"/>", // 👁
  "unas": "<rect x=\"9.4\" y=\"2.8\" width=\"5.2\" height=\"6.2\" rx=\"1.4\"/><rect x=\"6\" y=\"9\" width=\"12\" height=\"12.2\" rx=\"3.2\"/><path class=\"a\" d=\"M9.4 13v4.5\"/>", // 💅
  "depilacion": "<path d=\"M11 3.5 12.8 8.7 18 10.5 12.8 12.3 11 17.5 9.2 12.3 4 10.5 9.2 8.7z\"/><path class=\"a\" d=\"M18.3 15v5.2M15.7 17.6h5.2\"/>", // ✨
  "ok": "<circle  cx=\"12\" cy=\"12\" r=\"8.6\"/><path class=\"a\" d=\"m8.4 12.2 2.5 2.5 4.8-4.9\"/>", // ✅
  "cerrar": "<path d=\"M7 7l10 10M17 7 7 17\"/>", // ✕
  "editar": "<path d=\"M14.8 4.8a2.2 2.2 0 0 1 3.1 0l1.3 1.3a2.2 2.2 0 0 1 0 3.1L9.4 19H5v-4.4z\"/><path class=\"a\" d=\"m13.2 6.4 4.4 4.4\"/>", // ✎
  "borrar": "<path d=\"M4 7h16M9.5 7V5a1.2 1.2 0 0 1 1.2-1.2h2.6A1.2 1.2 0 0 1 14.5 5v2M6.4 7l.9 12.2a1.8 1.8 0 0 0 1.8 1.6h5.8a1.8 1.8 0 0 0 1.8-1.6L17.6 7\"/><path class=\"a\" d=\"M10 11v5.8M14 11v5.8\"/>", // 🗑
  "buscar": "<circle  cx=\"10.8\" cy=\"10.8\" r=\"6.3\"/><path class=\"a\" d=\"m15.6 15.6 4.6 4.6\"/>", // 🔍
  "ubicacion": "<path d=\"M12 21s7-6.2 7-11.6a7 7 0 1 0-14 0C5 14.8 12 21 12 21z\"/><circle class=\"af\" cx=\"12\" cy=\"9.6\" r=\"2.5\"/>", // 📍
  "mensaje": "<path d=\"M4 6.6A2.6 2.6 0 0 1 6.6 4h10.8A2.6 2.6 0 0 1 20 6.6v7.8a2.6 2.6 0 0 1-2.6 2.6H10.5L6 20.5V17h0a2.6 2.6 0 0 1-2-2.5z\"/><circle class=\"af\" cx=\"8.5\" cy=\"10.6\" r=\"1\"/><circle class=\"af\" cx=\"12\" cy=\"10.6\" r=\"1\"/><circle class=\"af\" cx=\"15.5\" cy=\"10.6\" r=\"1\"/>", // 💬
  "ofrecer": "<path d=\"M4 10v4h3l8 4.5v-13L7 10z\"/><path d=\"m7.6 14.2 1.2 5\"/><path class=\"a\" d=\"M18.3 9.5a3.6 3.6 0 0 1 0 5\"/>", // 📣
  "sellos": "<path d=\"M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z\"/><path class=\"a\" d=\"M14.6 7.5v1.5M14.6 11.2v1.6M14.6 15v1.5\"/>", // 🎟️
  "premio": "<rect x=\"4\" y=\"9.4\" width=\"16\" height=\"10.8\" rx=\"2\"/><path d=\"M3.4 9.4h17.2\"/><path class=\"a\" d=\"M12 9.4v10.8M12 9.4c-1.6-3.9-5.6-4.4-5.3-1.8.2 1.6 3.3 1.8 5.3 1.8zm0 0c1.6-3.9 5.6-4.4 5.3-1.8-.2 1.6-3.3 1.8-5.3 1.8z\"/>", // 🎁
  "estrella": "<path class=\"af2\" d=\"m12 3.6 2.5 5.2 5.6.8-4.1 3.9 1 5.6L12 16.4l-5 2.7 1-5.6-4.1-3.9 5.6-.8z\"/>", // ★
  "ofertaflash": "<path class=\"af2\" d=\"M13.4 3 5.6 13.4h5.6L10.4 21l8-10.4h-5.6z\"/>", // ⚡
  "espera": "<path d=\"M7 3.5h10M7 20.5h10M8 3.5c0 4.6 8 4.4 8 8.5s-8 3.9-8 8.5M16 3.5c0 4.6-8 4.4-8 8.5s8 3.9 8 8.5\"/><path class=\"a\" d=\"M9.6 19.2c.9-1.8 3.9-1.8 4.8 0\"/>", // ⏳
  "bloquear": "<circle  cx=\"12\" cy=\"12\" r=\"8.6\"/><path class=\"a\" d=\"M6 18 18 6\"/>", // ⛔
  "descanso": "<path d=\"M3.6 11.4a8.4 8.4 0 0 1 16.8 0z\"/><path d=\"M12 11.4v7.8a1.6 1.6 0 0 0 3.2 0\"/><path class=\"a\" d=\"M12 3a3.6 8.4 0 0 0-3.6 8.4M12 3a3.6 8.4 0 0 1 3.6 8.4\"/>", // 🏖️
  "candado": "<rect x=\"5\" y=\"10.5\" width=\"14\" height=\"10\" rx=\"2.6\"/><path d=\"M8 10.5V8a4 4 0 0 1 8 0v2.5\"/><circle class=\"af\" cx=\"12\" cy=\"15.5\" r=\"1.5\"/>", // 🔒
  "aviso": "<path d=\"M10.3 4.6a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H5a2 2 0 0 1-1.7-3z\"/><path class=\"a\" d=\"M12 9.5v4\"/><circle class=\"af\" cx=\"12\" cy=\"16.6\" r=\"1\"/>", // ⚠
  "sena": "<rect x=\"3\" y=\"5.5\" width=\"18\" height=\"13\" rx=\"2.6\"/><path d=\"M3 10h18\"/><path class=\"a\" d=\"M6.5 14.6h3.4\"/>", // 💳
  "efectivo": "<rect x=\"3\" y=\"6.5\" width=\"18\" height=\"11\" rx=\"2.2\"/><circle class=\"a\" cx=\"12\" cy=\"12\" r=\"2.6\"/><path d=\"M6.5 9.8v.01M17.5 14.2v.01\"/>", // 💵
  "transferencia": "<path d=\"M4.5 9h13.8M15 5.6 18.4 9 15 12.4\"/><path class=\"a\" d=\"M19.5 15H5.7M9 11.6 5.6 15 9 18.4\"/>", // 🏦
  "mp": "<rect x=\"6.5\" y=\"2.8\" width=\"11\" height=\"18.4\" rx=\"2.6\"/><path d=\"M10.5 18.2h3\"/><path class=\"a\" d=\"m9.6 10.6 1.7 1.7 3.2-3.3\"/>", // 📱
  "telefono": "<path d=\"M6.6 3.6h2.6l1.6 4.2-2.2 1.4a11 11 0 0 0 6.2 6.2l1.4-2.2 4.2 1.6v2.6a2 2 0 0 1-2.2 2C11.4 18.8 5.2 12.6 4.6 5.8a2 2 0 0 1 2-2.2z\"/><path class=\"a\" d=\"M15 3.8a5.2 5.2 0 0 1 5.2 5.2\"/>", // 📞
  "dni": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2.6\"/><circle  cx=\"8.6\" cy=\"10.8\" r=\"2\"/><path d=\"M5.6 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4\"/><path class=\"a\" d=\"M14 10h4M14 13.6h3\"/>", // 🪪
  "foto": "<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"3\"/><circle class=\"af\" cx=\"9\" cy=\"9.6\" r=\"1.6\"/><path d=\"m3.8 17 4.6-4.6a1.6 1.6 0 0 1 2.3 0l2.3 2.3 2.1-2.1a1.6 1.6 0 0 1 2.3 0l3 3\"/>", // 📷
  "email": "<rect x=\"3\" y=\"5.5\" width=\"18\" height=\"13\" rx=\"2.6\"/><path class=\"a\" d=\"m4 7.4 8 5.6 8-5.6\"/>", // ✉️
  "imprimir": "<path d=\"M7 9V4h10v5\"/><rect x=\"3.5\" y=\"9\" width=\"17\" height=\"8\" rx=\"2.4\"/><path d=\"M7 14.5h10V20H7z\"/><circle class=\"af\" cx=\"17\" cy=\"12\" r=\"0.9\"/>", // 🖨
  "ver": "<path d=\"M2.8 12c2.4-3.6 5.5-5.4 9.2-5.4s6.8 1.8 9.2 5.4c-2.4 3.6-5.5 5.4-9.2 5.4S5.2 15.6 2.8 12z\"/><circle class=\"af\" cx=\"12\" cy=\"12\" r=\"2.6\"/>", // 👁
  "manana": "<circle class=\"a\" cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4\"/>", // ☀️
  "tarde": "<path class=\"a\" d=\"M7.4 10.2a3.8 3.8 0 0 1 6.9-2.6M10.6 2.8v1.6M4.4 5.4l1.1 1.1M2.8 10.6h1.6\"/><path d=\"M8.4 20h8.8a3.4 3.4 0 0 0 .3-6.8 4.9 4.9 0 0 0-9.4 1.1 2.9 2.9 0 0 0 .3 5.7z\"/>", // 🌤️
  "noche": "<path d=\"M19.8 14.6A8.2 8.2 0 1 1 9.4 4.2a6.6 6.6 0 0 0 10.4 10.4z\"/><circle class=\"af\" cx=\"17.2\" cy=\"5.4\" r=\"1.1\"/>", // 🌙
  "triste": "<circle  cx=\"12\" cy=\"12\" r=\"8.6\"/><circle class=\"df\" cx=\"9\" cy=\"10\" r=\"1\"/><circle class=\"df\" cx=\"15\" cy=\"10\" r=\"1\"/><path class=\"a\" d=\"M8.8 16.2a4.4 4.4 0 0 1 6.4 0\"/>", // 😕
  "fiesta": "<path d=\"M4 20l4.6-11.4 6.8 6.8z\"/><path class=\"a\" d=\"M14 4.5c.6 1.4.2 2.6-1 3.4M19.5 10c-1.4-.6-2.6-.2-3.4 1\"/><circle class=\"af\" cx=\"17.6\" cy=\"4.6\" r=\"1\"/><circle class=\"af\" cx=\"20\" cy=\"7.6\" r=\"0.9\"/><circle class=\"af\" cx=\"12.6\" cy=\"3\" r=\"0.9\"/>", // 🎉
  "mapa": "<path d=\"M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z\"/><path d=\"M9 4.5v13\"/><path class=\"a\" d=\"M15 6.5v13\"/>", // 🗺️
  "novoy": "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"3\"/><path d=\"M3.5 10h17M8 3v4M16 3v4\"/><path class=\"a\" d=\"m9.8 13.2 4.4 4.4M14.2 13.2l-4.4 4.4\"/>", // 🙅
  "sube": "<path d=\"M4 20h16\"/><path class=\"a\" d=\"m4.5 15.5 5-5 3 3 6-6M14.5 7.5h4v4\"/>", // 📈
  "baja": "<path d=\"M4 20h16\"/><path class=\"a\" d=\"m4.5 6.5 5 5 3-3 6 6M14.5 14.5h4v-4\"/>", // 📉
  "web": "<circle  cx=\"12\" cy=\"12\" r=\"8.6\"/><path d=\"M3.4 12h17.2\"/><path class=\"a\" d=\"M12 3.4c2.4 2.4 3.6 5.3 3.6 8.6s-1.2 6.2-3.6 8.6c-2.4-2.4-3.6-5.3-3.6-8.6S9.6 5.8 12 3.4z\"/>", // 🌐
  "error": "<circle  cx=\"12\" cy=\"12\" r=\"8.6\"/><path d=\"m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6\"/>", // ❌
  "pausa": "<circle  cx=\"12\" cy=\"12\" r=\"8.6\"/><path class=\"a\" d=\"M10 9v6M14 9v6\"/>", // ⏸
  "carrito": "<path d=\"M3 4h2.2l2.2 10.6a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L20 8H6.2\"/><circle class=\"af\" cx=\"9.5\" cy=\"19.6\" r=\"1.3\"/><circle class=\"af\" cx=\"16.5\" cy=\"19.6\" r=\"1.3\"/>", // 🛒
  "caminar": "<circle class=\"af\" cx=\"13.2\" cy=\"4.6\" r=\"1.9\"/><path d=\"m12.4 8.4-2 6 3.2 2.6.9 4.4M10.4 14.4 8.2 20.6M12.4 8.4l3.2 2.6 2.6.2M12.4 8.4 9 9.8 7.6 12.6\"/>", // 🚶
  "contactos": "<rect x=\"5.5\" y=\"3.5\" width=\"14\" height=\"17\" rx=\"2.6\"/><circle  cx=\"12.5\" cy=\"10\" r=\"2.4\"/><path d=\"M8.9 16.4c.7-1.7 2-2.6 3.6-2.6s2.9.9 3.6 2.6\"/><path class=\"a\" d=\"M3.5 8h4M3.5 12h4M3.5 16h4\"/>", // 📇
  "sinapp": "<rect x=\"6.5\" y=\"2.8\" width=\"11\" height=\"18.4\" rx=\"2.6\"/><path d=\"M10.5 18.2h3\"/><path class=\"a\" d=\"M4 4l16 16\"/>", // 📵
  "celu": "<rect x=\"6.5\" y=\"2.8\" width=\"11\" height=\"18.4\" rx=\"2.6\"/><path d=\"M10.5 18.2h3\"/><circle class=\"af\" cx=\"12\" cy=\"10.5\" r=\"2\"/>", // 📱
  "abierto": "<rect x=\"5\" y=\"10.5\" width=\"14\" height=\"10\" rx=\"2.6\"/><path d=\"M8 10.5V8a4 4 0 0 1 7.6-1.8\"/><circle class=\"af\" cx=\"12\" cy=\"15.5\" r=\"1.5\"/>", // 🔓
  "torta": "<path d=\"M4.5 20.5h15M5.5 20.5v-6.8a1.7 1.7 0 0 1 1.7-1.7h9.6a1.7 1.7 0 0 1 1.7 1.7v6.8\"/><path d=\"M5.5 15.6c1.1 1 2.2 1 3.3 0s2.2-1 3.2 0 2.2 1 3.2 0 2.2-1 3.3 0M12 12V9\"/><path class=\"af\" d=\"M12 4.2c1 1 1.3 1.9 1 2.6a1.1 1.1 0 0 1-2 0c-.3-.7 0-1.6 1-2.6z\"/>", // 🎂
  "fuego": "<path d=\"M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4.4-3.6-6.4-4.4-10.5-2.6 1.6-3.8 4-3.6 6.6-1.2-.6-2-1.8-2.2-3.2A8 8 0 0 0 5.5 14.5 6.5 6.5 0 0 0 12 21z\"/><path class=\"a\" d=\"M12 18a2.6 2.6 0 0 1-2.6-2.6c0-1.6 1.4-2.4 2.6-4.1 1.2 1.7 2.6 2.5 2.6 4.1A2.6 2.6 0 0 1 12 18z\"/>", // 🔥
  "brote": "<path d=\"M12 20.5V11M7.5 20.5h9\"/><path class=\"a\" d=\"M12 13.5c0-3.6-2.6-6-7-6 0 4 2.8 6 7 6zM12 11c0-3.4 2.4-5.6 6.6-5.6 0 3.8-2.6 5.6-6.6 5.6z\"/>", // 🌱
  "dormido": "<path d=\"M4 9.5h5l-5 6h5M14 14h5.5L14 20.5h5.5\"/><path class=\"a\" d=\"M13 3.5h4l-4 4.8h4\"/>", // 💤
  "estado-on": "<circle class=\"af\" cx=\"12\" cy=\"12\" r=\"5\"/>", // 🟢
  "estado-off": "<circle  cx=\"12\" cy=\"12\" r=\"5\"/>", // ⚪
};
const ALIAS = { chispa: "depilacion", nota: "editar" };
export const ic = (name, cls = "") =>
  `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[ALIAS[name] || name] || ""}</svg>`;
export const ICON_NAMES = [...Object.keys(ICONS), ...Object.keys(ALIAS)];
