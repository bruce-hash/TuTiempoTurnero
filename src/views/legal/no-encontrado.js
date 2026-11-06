import { ic } from "../../ui/iconos.js";
// dirección que no existe: un link mal escrito o un prestador que ya no está (Bloque B)
export function vNotFound() {
  return `<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center">
   <div class="hero-ic">${ic("buscar")}</div><h1 class="h1">No encontramos esta página</h1>
   <p class="lead">Puede que el link esté mal escrito o que el profesional ya no esté en TuTiempo.</p>
   <button class="btn btn-pri btn-block" data-go="home">Ver los profesionales</button></div></div>`;
}
