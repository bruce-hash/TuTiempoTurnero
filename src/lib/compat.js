var W = Object.defineProperty;
var U = Object.getOwnPropertySymbols;
var J = Object.prototype.hasOwnProperty;
var Q = Object.prototype.propertyIsEnumerable;
var Y = (e, a, t) =>
  a in e
    ? W(e, a, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: t,
      })
    : (e[a] = t);
export var H = (e, a) => {
  for (var t in (a ||= {})) {
    if (J.call(a, t)) {
      Y(e, t, a[t]);
    }
  }
  if (U) {
    for (var t of U(a)) {
      if (Q.call(a, t)) {
        Y(e, t, a[t]);
      }
    }
  }
  return e;
};
