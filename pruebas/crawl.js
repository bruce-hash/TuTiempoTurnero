// Uso: node crawl.js prototipo.html  (con jsdom instalado)
// Recorre TODAS las pantallas y toca CADA botón/enlace interno, uno por uno, desde la misma pantalla.
// Marca: errores de JS, pantallas de error, toques que no hacen nada, y destinos equivocados (data-go / data-btab).
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const dom=new JSDOM('<!doctype html><body>'+html+'</body>',{runScripts:'dangerously',pretendToBeVisual:true,url:'https://demo.tutiempo.com.ar/'});
const w=dom.window;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.open=()=>null;w.HTMLElement.prototype.focus=function(){};const d=w.document;const errs=[];
w.addEventListener('error',e=>errs.push(e.message));w.console.error=(...a)=>errs.push(a.map(x=>x&&x.stack||String(x)).join(' '));
w.HTMLAnchorElement.prototype.click=function(){};
const tick=(ms=2)=>new Promise(r=>setTimeout(r,ms));
const SIGN='if(!S.user)demoSignIn("juan.perez@gmail.com","Juan Pérez");';
const prov=(t,extra='')=>`S.role="barbero";S.barberAuth=true;S.preview=false;useProvider(7);selectBtab("${t}");${extra}render()`;
const SCREENS=[
 ['cliente · inicio','S.role="cliente";'+SIGN+'go("home")'],
 ['cliente · inicio sin sesión','S.role="cliente";S.user=null;go("home")'],
 ['cliente · perfil','S.role="cliente";'+SIGN+'go("perfil",7)'],
 ['cliente · perfil con horario','S.role="cliente";'+SIGN+'go("perfil",7);(()=>{for(let i=1;i<10;i++){const k=dkey(addDays(i));const f=slotsFor(7,k,30).list.find(x=>x.free);if(f){S.day=k;S.slot={date:k,time:f.time};break}}})();render()'],
 ['cliente · perfil trabajos','S.role="cliente";'+SIGN+'go("perfil",7);S.ptab="media";render()'],
 ['cliente · perfil reseñas','S.role="cliente";'+SIGN+'go("perfil",7);S.ptab="rev";render()'],
 ['cliente · checkout','S.role="cliente";'+SIGN+'go("perfil",7);(()=>{for(let i=1;i<10;i++){const k=dkey(addDays(i));const f=slotsFor(7,k,30).list.find(x=>x.free);if(f){S.day=k;S.slot={date:k,time:f.time};break}}})();go("checkoutT")'],
 ['cliente · mis turnos','S.role="cliente";'+SIGN+'go("misturnos")'],
 ['cliente · mi turno','S.role="cliente";'+SIGN+'(()=>{const b=BOOK.find(x=>x.mine&&x.status==="confirmed");S.turnoId=b&&b.id;S.justBooked=false})();go("turnoOk")'],
 ['cliente · cuenta','S.role="cliente";'+SIGN+'go("cuenta")'],
 ['cliente · login','S.role="cliente";S.user=null;go("login")'],
 ['cliente · registro','S.role="cliente";S.user=null;go("register")'],
 ['cliente · sumate prestador','S.role="cliente";go("prestador")'],
 ['cliente · términos','S.role="cliente";go("terminos")'],
 ['cliente · acceso prestadores','S.role="cliente";go("loginBarbero")'],
 ...['agenda','caja','finanzas','clientes','productos','horarios','stats','comunidad','perfil'].map(t=>['prestador · '+t,prov(t)]),
 ['prestador · finanzas mes','S.role="barbero";S.barberAuth=true;useProvider(7);selectBtab("finanzas");S.fp="mes";render()'],
 ['prestador · finanzas mes cerrado','S.role="barbero";S.barberAuth=true;useProvider(7);selectBtab("finanzas");S.fp="mes";(()=>{const d=new Date(TODAY().slice(0,7)+"-15T12:00:00");d.setMonth(d.getMonth()-1);S.fm=dkey(d).slice(0,7);CLOSINGS["month|"+S.fm]={income:1,expenses:1,at:"10:00"}})();render()'],
 ['prestador · bloquear días (lista)','S.role="barbero";S.barberAuth=true;useProvider(7);selectBtab("horarios");(()=>{const b=BOOK.find(x=>x.pid==7&&x.status==="confirmed"&&x.type!=="block"&&x.date>TODAY());S.dbAsk={from:b.date,to:b.date,why:"x",list:[b]}})();render()'],
 ['prestador · finanzas año','S.role="barbero";S.barberAuth=true;useProvider(7);selectBtab("finanzas");S.fp="anio";render()'],
 ['prestador · stats mes','S.role="barbero";S.barberAuth=true;useProvider(7);selectBtab("stats");S.sv="mes";render()'],
 ['prestador · stats año','S.role="barbero";S.barberAuth=true;useProvider(7);selectBtab("stats");S.sv="anio";render()'],
 ['prestador · vista pública','S.role="barbero";S.barberAuth=true;useProvider(7);S.preview=true;S.pid=7;render()'],
 ...['res','prov','bal','com'].map(t=>['admin · '+t,`S.role="admin";S.admT="${t}";S.admM=null;render()`]),
 ['admin · ficha','S.role="admin";S.admT="prov";S.admOpen=7;render()'],
 ['admin · mes del balance','S.role="admin";S.admT="bal";S.admM=(()=>{const x=new Date(TODAY().slice(0,7)+"-15T12:00:00");x.setMonth(x.getMonth()-1);return dkey(x).slice(0,7)})();render()'],
];
const SKIP=new Set(['logout','salirBarbero','delYes','google','salirAdmin']);
const sig=el=>el.tagName+'|'+[...el.attributes].filter(a=>a.name.startsWith('data-')||a.name==='type').map(a=>a.name+'='+a.value).join(',')+'|'+el.textContent.trim().slice(0,40);
const snap=()=>{const t=d.getElementById('toast');return d.getElementById('app').innerHTML+'§'+(d.getElementById('nav')||{}).innerHTML+'§'+(t&&!t.hidden?t.textContent:'')+'§'+[...d.querySelectorAll('.notif,.sheet,.modal')].map(x=>x.outerHTML).join('')+'§'+w.eval('JSON.stringify(Object.assign({},S,{list:null}))')};
const sel='#app button:not([disabled]),#app [data-go],#app [data-act],#app [data-btab],#app input[type=checkbox],#app input[type=radio],#nav button,#nav [data-go]';
(async()=>{await tick(40);let total=0;const dead=[],wrong=[],broken=[];
 for(const [name,setup] of SCREENS){
  w.eval(setup);await tick();
  const list=[...d.querySelectorAll(sel)].filter(x=>!x.closest('a[target]')&&!SKIP.has(x.dataset.act)).map(sig);
  const uniq=[...new Set(list)];
  for(const s0 of uniq){
   w.eval(setup);await tick();
   const el=[...d.querySelectorAll(sel)].find(x=>sig(x)===s0);if(!el)continue;
   const before=snap();const e0=errs.length;const t0=d.getElementById('toast').textContent;d.getElementById('toast').textContent='';
   try{el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}))}catch(e){errs.push(e.message)}
   await tick(3);total++;
   const lbl=`${name} → [${s0.split('|')[1]}] "${s0.split('|')[2]}"`;
   if(errs.length>e0)broken.push(lbl+' · '+errs.slice(e0).join(' / ').slice(0,160));
   if(d.querySelector('.apperr'))broken.push(lbl+' · pantalla de error');
   const changed=snap()!==before||d.getElementById('toast').textContent!=='';
   const isInput=el.tagName==='INPUT';
   if(!changed&&!isInput&&el.type!=='submit')dead.push(lbl);
   const go=el.dataset.go;if(go&&!el.dataset.act){const v=w.eval('S.view'),r=w.eval('S.role');if(r==='cliente'&&v!==go&&!(['login','cuenta'].includes(v)))wrong.push(lbl+` · quedó en "${v}"`)}
   const bt=el.dataset.btab;if(bt&&w.eval('S.role')==='barbero'&&w.eval('S.btab')!==bt)wrong.push(lbl+` · quedó en pestaña "${w.eval('S.btab')}"`);
  }
 }
 console.log('toques',total);console.log('ERRORES',broken.length);broken.forEach(x=>console.log('  ✗ '+x));
 console.log('DESTINO EQUIVOCADO',wrong.length);wrong.forEach(x=>console.log('  ✗ '+x));
 console.log('SIN EFECTO',dead.length);dead.forEach(x=>console.log('  · '+x));
 process.exit(broken.length||wrong.length?1:0)})();
