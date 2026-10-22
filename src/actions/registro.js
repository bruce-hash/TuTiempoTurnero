// Registro de acciones: cada pantalla registra las suyas (data-act o id del formulario → función).
// Los listeners de document (toques.js, formularios.js, cambios.js) buscan acá qué función corresponde.
export const CLICK = new Map();
export const SUBMIT = new Map();
export const CHANGE = new Map();
export const INPUT = new Map();
function register(map, names, fn) {
  for (const name of [].concat(names)) {
    if (map.has(name)) {
      throw new Error("Acción registrada dos veces: " + name);
    }
    map.set(name, fn);
  }
}
export const registerClick = (names, fn) => register(CLICK, names, fn);
export const registerSubmit = (names, fn) => register(SUBMIT, names, fn);
export const registerChange = (names, fn) => register(CHANGE, names, fn);
export const registerInput = (names, fn) => register(INPUT, names, fn);
