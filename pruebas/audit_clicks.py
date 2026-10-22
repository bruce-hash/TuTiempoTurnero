import re,sys,collections
s=open(sys.argv[1],encoding="utf-8").read()
js=s[s.index("<script>")+8:s.rindex("</script>")]
emit=collections.Counter(re.findall(r'data-act="([A-Za-z0-9_]+)"',js))
dyn=re.findall(r'data-act="(\$\{[^"]{0,80})',js)
# variable del manejador de toques: "act" en el app.cjs del cliente, "v" en src/prototipo.html (const v = x.dataset.act)
hv=(re.search(r'const\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\.dataset\.act\s*;',js) or [None,"act"])[1]
handled=set(re.findall(r'\b'+re.escape(hv)+r'\s*===?\s*"([A-Za-z0-9_]+)"',js))
# acts handled via arrays like ["a","b"].includes(act)
for m in re.finditer(r'\[([^\[\]]{1,3000})\]\.includes\('+re.escape(hv)+r'\)',js): handled|=set(re.findall(r'"([A-Za-z0-9_]+)"',m.group(1)))
print("data-act emitidos sin manejador:",sorted(set(emit)-handled))
print("manejadores sin emisor (código muerto o dinámico):",sorted(handled-set(emit)))
print("data-act dinámicos:",sorted(set(dyn))[:20])
gos=set(re.findall(r'data-go="([A-Za-z0-9_]+)"',js))|set(re.findall(r'go\(\s*"([A-Za-z0-9_]+)"',js))
views=set(re.findall(r'S\.view\s*===\s*"([A-Za-z0-9_]+)"',js))|set(re.findall(r'(?:^|[,{ ])([A-Za-z0-9_]+):\(?\)?=>\s*v[A-Z]',js))
vm=re.search(r'const VIEWS=\{(.*?)\};',js,re.S)
print("go() destinos:",sorted(gos))
forms=set(re.findall(r'<form[^>]*id="([A-Za-z0-9_]+)"',js))
fh=set(re.findall(r'e\.target\.id\s*===\s*"([A-Za-z0-9_]+)"',js))
print("forms sin submit:",sorted(forms-fh));print("submit sin form:",sorted(fh-forms))
attrs=collections.Counter(re.findall(r'data-([a-z0-9]+)="',js))
print("atributos data-*:",sorted(attrs))
# falla solo ante huecos reales: un data-act sin rama en el manejador o un formulario sin envío
sys.exit(1 if (set(emit)-handled) or (forms-fh) else 0)
