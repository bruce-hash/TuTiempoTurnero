// Ayudantes que dejó el minificador del cliente (esbuild): H(destino, origen) copia las propiedades de origen,
// incluidas las de tipo Symbol, como un Object.assign.
var W = Object.defineProperty;
var U = Object.getOwnPropertySymbols;
var J = Object.prototype.hasOwnProperty;
var Q = Object.prototype.propertyIsEnumerable;
var Y = (obj, key, value) =>
  key in obj
    ? W(obj, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: value,
      })
    : (obj[key] = value);
export var H = (target, source) => {
  for (var key in (source ||= {})) {
    if (J.call(source, key)) {
      Y(target, key, source[key]);
    }
  }
  if (U) {
    for (var key of U(source)) {
      if (Q.call(source, key)) {
        Y(target, key, source[key]);
      }
    }
  }
  return target;
};
