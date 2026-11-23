(function(){
  "use strict";
  /* Compensa · simulador para jóvenes que quieren independizarse.
     Bono Alquiler Joven (Plan Estatal): 250 €/mes, máx. 24 meses, 18-35 años, ingresos ≤ 3 IPREM (~25.200 € brutos/año),
     alquiler ≤ 600 € piso / 300 € habitación (hasta 900 / 450 € en zonas con límite ampliado). */
  var BONO = {mes:250, meses:24, edadMin:18, edadMax:35, brutoMax:25200, piso:600, pisoExc:900, hab:300, habExc:450};

  var EMPTY = {nombre:"",tipo:"piso",ingresos:0,vivienda:0,gastos:0,inicial:0,bono:false,prestamo:0,interes:0,anios:0,bien:0,reval:0};
  function sc(o){ var r={}; for(var k in EMPTY) r[k]=EMPTY[k]; for(var j in o) r[j]=o[j]; return r; }
  var TIPOS = {padres:"Casa de mis padres", habitacion:"Habitación compartida", piso:"Piso de alquiler", compra:"Piso comprado"};

  var TEMPLATES = {
    solo:{label:"🏠 Irme de casa", edad:26, ahorro:6000, rent:2,
      A:sc({nombre:"Sigo en casa", tipo:"padres", ingresos:1350, vivienda:150, gastos:350}),
      B:sc({nombre:"Me voy solo/a", tipo:"piso", ingresos:1350, vivienda:600, gastos:450, inicial:2200, bono:true})},
    compartir:{label:"🛏️ Compartir o piso solo", edad:25, ahorro:6000, rent:2,
      A:sc({nombre:"Habitación", tipo:"habitacion", ingresos:1500, vivienda:420, gastos:380, inicial:900, bono:true}),
      B:sc({nombre:"Piso para mí", tipo:"piso", ingresos:1500, vivienda:750, gastos:480, inicial:2400, bono:true})},
    pareja:{label:"💑 Con mi pareja", edad:28, ahorro:7000, rent:2,
      A:sc({nombre:"Solo/a", tipo:"piso", ingresos:1500, vivienda:750, gastos:480, bono:true}),
      B:sc({nombre:"Con mi pareja", tipo:"piso", ingresos:1500, vivienda:450, gastos:380, inicial:1200, bono:true})},
    comprar:{label:"🔑 Comprar con aval ICO", edad:31, ahorro:18000, rent:2,
      A:sc({nombre:"Sigo de alquiler", tipo:"piso", ingresos:1900, vivienda:800, gastos:550}),
      B:sc({nombre:"Compro con aval", tipo:"compra", ingresos:1900, vivienda:60, gastos:550, inicial:16000, prestamo:160000, interes:2.9, anios:30, bien:160000, reval:2})},
    libre:{label:"✏️ Personalizado", edad:25, ahorro:3000, rent:2,
      A:sc({nombre:"Opción A", tipo:"padres", ingresos:1200, vivienda:100, gastos:300}),
      B:sc({nombre:"Opción B", tipo:"piso", ingresos:1200, vivienda:550, gastos:400, inicial:1800})}
  };

  var state = {tpl:"solo", tab:"A", h:5, edad:25, ahorro:0, rent:0, ahorroMes:400, A:null, B:null, aiUses:0, decId:null, perfil:null};

  var $ = function(id){ return document.getElementById(id); };
  var eur = function(n){ var r=Math.round(n), s=String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g,"."); return (r<0?"−":"")+s+" €"; };
  var signed = function(n){ return (n>=0?"+":"−") + eur(Math.abs(n)); };
  var short = function(n){ var a=Math.abs(n), s=n<0?"−":"";
    if(a>=1e6) return s+(a/1e6).toFixed(1).replace(".",",")+"M"; if(a>=1e3) return s+Math.round(a/1e3)+"k"; return s+Math.round(a); };
  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function num(v){ var n=parseFloat(String(v).replace(",",".")); return isFinite(n)?n:0; }

  /* ---------- IRPF aproximado (demo) ---------- */
  function netoDesdeBruto(bruto){
    var ss=Math.min(bruto, 61000)*0.0647;
    var base=Math.max(0, bruto-ss-2000);
    var tramos=[[12450,.19],[20200,.24],[35200,.30],[60000,.37],[300000,.45],[Infinity,.47]];
    function escala(b){ var t=0,prev=0; for(var k=0;k<tramos.length;k++){ var lim=tramos[k][0]; if(b>prev){ t+=(Math.min(b,lim)-prev)*tramos[k][1]; } prev=lim; } return t; }
    var irpf=Math.max(0, escala(base)-escala(5550));
    return {neto:bruto-ss-irpf};
  }
  var NETO_MAX_BONO = netoDesdeBruto(BONO.brutoMax).neto/12;

  /* ---------- Bono Alquiler Joven ---------- */
  function elig(s){
    if(s.tipo!=="piso" && s.tipo!=="habitacion") return {ok:false, cls:"no", txt:"Solo para alquiler de piso o habitación."};
    if(state.edad<BONO.edadMin || state.edad>BONO.edadMax) return {ok:false, cls:"no", txt:"Es para jóvenes de 18 a 35 años."};
    if(s.ingresos>NETO_MAX_BONO+1) return {ok:false, cls:"no", txt:"Tus ingresos superan el límite (~25.200 € brutos/año)."};
    var lim = s.tipo==="piso"?BONO.piso:BONO.hab, exc = s.tipo==="piso"?BONO.pisoExc:BONO.habExc;
    if(s.vivienda<=lim) return {ok:true, cls:"ok", txt:"Cumples los requisitos básicos."};
    if(s.vivienda<=exc) return {ok:true, cls:"meh", txt:"Solo si tu zona tiene el límite ampliado ("+exc+" €). Consúltalo."};
    return {ok:false, cls:"no", txt:"El alquiler supera el máximo permitido ("+exc+" €)."};
  }
  function bonoActivo(s){ return s.bono && elig(s).ok; }

  /* ---------- modelo ---------- */
  function cuotaDe(s){
    if(s.prestamo<=0 || s.anios<=0) return 0;
    var i=s.interes/100/12, n=s.anios*12;
    return i>0 ? s.prestamo*i/(1-Math.pow(1+i,-n)) : s.prestamo/n;
  }
  function simulate(s, months){
    var r=state.rent/100/12, i=s.interes/100/12, cuota=cuotaDe(s), bono=bonoActivo(s);
    var cash=state.ahorro - s.inicial, debt=s.prestamo, asset=s.bien, g=Math.pow(1+s.reval/100,1/12);
    var series=[cash+asset-debt], quiebra=cash<0?0:-1, totalInt=0, bonoTotal=0;
    for(var m=1;m<=months;m++){
      var pay=0;
      if(debt>0.01){ var it=debt*i; totalInt+=it; pay=Math.min(cuota, debt+it); debt=debt+it-pay; }
      if(cash>0) cash*=(1+r);
      var extra = (bono && m<=BONO.meses) ? BONO.mes : 0; bonoTotal+=extra;
      cash += s.ingresos + extra - s.vivienda - s.gastos - pay;
      asset*=g;
      if(cash<0 && quiebra<0) quiebra=m;
      series.push(cash+asset-debt);
    }
    var vivMes = s.vivienda + cuota - (bono?BONO.mes:0);
    return {series:series, cuota:cuota, cash:cash, asset:asset, debt:Math.max(0,debt), quiebra:quiebra, intereses:totalInt,
            bonoTotal:bonoTotal, sobra:s.ingresos + (bono?BONO.mes:0) - s.vivienda - s.gastos - cuota,
            pct: s.ingresos>0 ? Math.max(0,vivMes)/s.ingresos : 0};
  }
  function pctInfo(p){
    if(p<=0.30) return {c:"var(--good)", t:"Sano"};
    if(p<=0.40) return {c:"var(--mid)", t:"Justo"};
    return {c:"var(--bad)", t:"Te ahoga"};
  }

  /* ---------- plantillas ---------- */
  function renderChips(){
    var h=""; for(var k in TEMPLATES) h+='<button class="chip'+(state.tpl===k?" on":"")+'" data-tpl="'+k+'">'+TEMPLATES[k].label+'</button>';
    $("chips").innerHTML=h;
  }
  function loadTpl(k){
    var t=TEMPLATES[k]; state.tpl=k; state.edad=t.edad; state.ahorro=t.ahorro; state.rent=t.rent;
    state.A=sc(t.A); state.B=sc(t.B); state.tab="A"; state.decId=null;
    $("edad").value=state.edad; $("ahorro").value=state.ahorro; $("rent").value=state.rent; $("aiOut").innerHTML="";
    renderChips(); renderEditor(); renderAll();
  }

  /* ---------- ¿Cuándo puedo irme? ---------- */
  function target(){
    // la opción que implica irse: B, o A si B es seguir en casa
    var s = state.B.tipo!=="padres" ? state.B : state.A;
    var colchon = 3*(s.vivienda + s.gastos + cuotaDe(s));
    return {s:s, entrada:s.inicial, colchon:colchon, total:s.inicial+colchon};
  }
  function renderGoal(){
    var t=target(), falta=Math.max(0,t.total-state.ahorro), pct=Math.min(100, t.total>0?state.ahorro/t.total*100:100);
    var meses = falta<=0 ? 0 : (state.ahorroMes>0 ? Math.ceil(falta/state.ahorroMes) : Infinity);
    var when;
    if(meses===0) when="¡Ya podrías irte!";
    else if(!isFinite(meses)) when="Necesitas ahorrar algo cada mes";
    else { var d=new Date(); d.setMonth(d.getMonth()+meses);
      when="Lista/o en "+meses+(meses===1?" mes":" meses")+" · "+d.toLocaleDateString("es-ES",{month:"long",year:"numeric"}); }
    $("goal").innerHTML =
      '<h2>🎯 ¿Cuándo puedo irme?</h2>'+
      '<div class="goal-big">'+when+'</div>'+
      '<div class="bar"><i style="width:'+pct.toFixed(0)+'%"></i></div>'+
      '<p>Para «'+esc(t.s.nombre||"irte")+'» necesitas <b>'+eur(t.total)+'</b>: '+eur(t.entrada)+' de entrada (fianza, mudanza, muebles…) + '+eur(t.colchon)+' de colchón para 3 meses.</p>'+
      '<p>Tienes '+eur(state.ahorro)+(falta>0?' · te faltan <b>'+eur(falta)+'</b>.':'.')+'</p>'+
      '<div class="field" style="margin:12px 0 0"><label for="ahorroMes">¿Cuánto puedes ahorrar al mes ahora?</label><div class="in"><input id="ahorroMes" type="number" inputmode="decimal" value="'+state.ahorroMes+'"><span>€/mes</span></div></div>'+
      '<button class="planbtn" id="planBtn">📅 Ver mi plan de ahorro mes a mes'+(esPro()?'':' · PRO')+'</button>';
  }

  /* ---------- editor ---------- */
  function field(key,label,unit,step){
    var v=state[state.tab][key];
    return '<div class="field"><label>'+label+'</label><div class="in"><input data-k="'+key+'" type="number" inputmode="decimal" step="'+(step||1)+'" value="'+v+'"><span>'+unit+'</span></div></div>';
  }
  function renderEditor(){
    var s=state[state.tab];
    document.querySelectorAll(".seg button").forEach(function(b){ b.classList.toggle("on", b.getAttribute("data-tab")===state.tab); });
    var opts=""; for(var k in TIPOS) opts+='<option value="'+k+'"'+(s.tipo===k?" selected":"")+'>'+TIPOS[k]+'</option>';
    var vivLabel = s.tipo==="padres"?"Lo que aportas en casa":(s.tipo==="compra"?"Comunidad, IBI y seguro":"Alquiler al mes");
    var showLoan = s.tipo==="compra" || s.prestamo>0 || s.bien>0;
    $("fields").innerHTML =
      '<div class="row"><div class="field"><label>Nombre</label><div class="in"><input class="txt" data-k="nombre" type="text" maxlength="22" value="'+esc(s.nombre)+'"></div></div>'+
      '<div class="field"><label>Dónde vives</label><div class="in"><select data-k="tipo">'+opts+'</select></div></div></div>'+
      '<div class="row">'+field("ingresos","Sueldo neto al mes","€")+field("vivienda",vivLabel,"€")+'</div>'+
      '<button class="link" id="brutoLink">¿Solo sabes tu sueldo bruto? Calcúlalo</button>'+
      '<div class="bruto" id="bruto"><div class="row">'+
        '<div class="field"><label>Bruto anual</label><div class="in"><input id="bAnual" type="number" inputmode="decimal" value="20000"><span>€</span></div></div>'+
        '<div class="field"><label>Pagas</label><div class="in"><input id="bPagas" type="number" inputmode="numeric" value="14"><span>pagas</span></div></div>'+
      '</div><div class="hint" id="bRes"></div><button class="btn soft" id="bApply">Usar este neto</button></div>'+
      '<div style="height:10px"></div>'+
      '<div class="row">'+field("gastos","Resto de gastos (comida, luz, ocio…)","€")+field("inicial","Pago inicial (fianza, mudanza…)","€")+'</div>'+
      ((s.tipo==="piso"||s.tipo==="habitacion") ? bonoBox(s) : '')+
      '<details'+(showLoan?" open":"")+'><summary>Hipoteca o compra (aval ICO)</summary>'+
        '<div class="hint">Con el aval ICO para menores de 36 años los bancos pueden financiar hasta el 100 % del piso. Aun así necesitas ahorros para impuestos y gastos (≈10 %).</div>'+
        '<div class="row">'+field("prestamo","Hipoteca","€")+field("interes","Interés (TIN)","%",0.1)+'</div>'+
        '<div class="row">'+field("anios","Plazo","años")+'<div class="field"><label>Cuota</label><div class="in"><input class="txt" id="cuotaOut" disabled value="'+eur(cuotaDe(s))+'/mes"></div></div></div>'+
        '<div class="row">'+field("bien","Precio del piso","€")+field("reval","Sube al año","%",0.5)+'</div>'+
      '</details>';
    updateBruto();
  }
  function bonoBox(s){
    var e=elig(s);
    return '<label class="bono'+(s.bono&&e.ok?" on":"")+'" id="bonoBox"><input type="checkbox" id="bonoChk"'+(s.bono?" checked":"")+'>'+
      '<div><b>Bono Alquiler Joven · +250 €/mes</b><small>Durante 2 años. <span class="'+e.cls+'">'+(e.ok?"✓ ":"✕ ")+e.txt+'</span></small></div></label>';
  }
  function updateBruto(){
    var a=$("bAnual"), p=$("bPagas"); if(!a) return;
    var b=num(a.value), pg=Math.max(12,Math.min(14,Math.round(num(p.value)||14))), r=netoDesdeBruto(b);
    $("bRes").innerHTML="Neto aprox.: <b>"+eur(r.neto/pg)+"</b> en "+pg+" pagas · <b>"+eur(r.neto/12)+"/mes</b> prorrateado."+
      (b<22000?"<br>Con sueldos bajos la retención real suele ser algo menor.":"");
  }

  /* ---------- resultados ---------- */
  function renderAll(){ renderGoal(); return renderResults(); }
  function renderResults(){
    var months=state.h*12, a=simulate(state.A,months), b=simulate(state.B,months);
    var nA=state.A.nombre||"Opción A", nB=state.B.nombre||"Opción B";
    $("lgA").textContent=nA; $("lgB").textContent=nB; $("tabA").textContent=nA; $("tabB").textContent=nB;
    var fa=a.series[months], fb=b.series[months], diff=fb-fa;
    var win = Math.abs(diff)<50 ? null : (diff>0?"B":"A"), be=breakeven(a.series,b.series), v=$("verdict");
    if(!win){
      v.style.background="#f0eee8";
      v.innerHTML='<div class="k">En '+yrs()+'</div><div class="big">Prácticamente igual</div><p>La diferencia es menor de 50 €. Decide por lo que no se mide en euros.</p>';
    } else {
      var wn=win==="B"?nB:nA, col=win==="B"?"var(--b)":"var(--a)";
      v.style.background=win==="B"?"var(--b2)":"var(--a2)";
      v.innerHTML='<div class="k">En '+yrs()+' en dinero gana</div><div class="big" style="color:'+col+'">'+esc(wn)+'</div>'+
        '<p>Tendrías <b>'+eur(Math.abs(diff))+' más</b> que con «'+esc(win==="B"?nA:nB)+'».'+(be?' Empieza a compensar en el <b>'+fmtMes(be)+'</b>.':'')+'</p>';
    }
    $("chart").innerHTML=chart(a.series,b.series,months);
    $("stats").innerHTML=stat("a",nA,fa,a,state.A)+stat("b",nB,fb,b,state.B);
    var msgs=[];
    [[a,nA],[b,nB]].forEach(function(x){ if(x[0].quiebra>=0) msgs.push("Con «"+esc(x[1])+"» te quedarías sin ahorros "+(x[0].quiebra===0?"desde el primer día (no te llega para la entrada)":"en el "+fmtMes(x[0].quiebra))+"."); });
    var w=$("warn"); w.style.display=msgs.length?"block":"none"; w.innerHTML=msgs.map(function(m){return "⚠️ "+m;}).join("<br>");
    var co=$("cuotaOut"); if(co) co.value=eur(cuotaDe(state[state.tab]))+"/mes";
    document.querySelectorAll("#hz button").forEach(function(x){ x.classList.toggle("on", +x.getAttribute("data-h")===state.h); });
    return {a:a,b:b,diff:diff,be:be,nA:nA,nB:nB,win:win};
  }
  function yrs(){ return state.h+(state.h>1?" años":" año"); }
  function fmtMes(m){ return "mes "+m+" (año "+(Math.floor((m-1)/12)+1)+")"; }
  function breakeven(sa,sb){
    var start=Math.sign(sb[0]-sa[0]); if(start===0) return null;
    for(var m=1;m<sa.length;m++){ if(sb[m]!==sa[m] && Math.sign(sb[m]-sa[m])!==start) return m; }
    return null;
  }
  function stat(cls,name,final,r,s){
    var parts=['Te sobran <b>'+eur(r.sobra)+'</b>/mes'];
    if(r.cuota>0) parts.push('Hipoteca: '+eur(r.cuota)+'/mes');
    if(bonoActivo(s)) parts.push('Bono: +'+eur(r.bonoTotal));
    if(r.asset>1) parts.push('Piso: '+eur(r.asset));
    if(r.debt>1) parts.push('Debes: '+eur(r.debt));
    var th="";
    if(s.tipo!=="padres"){ var p=pctInfo(r.pct);
      th='<div class="thermo">Vivienda'+(bonoActivo(s)?" (con bono)":"")+': <span style="color:'+p.c+'">'+Math.round(r.pct*100)+' % del sueldo · '+p.t+'</span><div class="t"><i style="width:'+Math.min(100,r.pct*100).toFixed(0)+'%;background:'+p.c+'"></i></div></div>'; }
    return '<div class="stat '+cls+'"><div class="n">'+esc(name)+'</div><div class="v">'+eur(final)+'</div><div class="m">'+parts.join("<br>")+'</div>'+th+'</div>';
  }
  function chart(sa,sb,months){
    var W=340,H=190,pl=40,pr=8,pt=10,pb=24, all=sa.concat(sb);
    var mn=Math.min.apply(null,all), mx=Math.max.apply(null,all);
    if(mx-mn<1){ mx+=500; mn-=500; }
    var pad=(mx-mn)*0.08; mn-=pad; mx+=pad;
    var x=function(m){ return pl+(W-pl-pr)*m/months; }, y=function(v){ return pt+(H-pt-pb)*(1-(v-mn)/(mx-mn)); };
    function path(s){ var d=""; for(var m=0;m<s.length;m++) d+=(m?"L":"M")+x(m).toFixed(1)+" "+y(s[m]).toFixed(1); return d; }
    var g="";
    for(var k=0;k<=3;k++){ var val=mn+(mx-mn)*k/3, yy=y(val);
      g+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+yy.toFixed(1)+'" y2="'+yy.toFixed(1)+'" stroke="#ece8df"/>'+
         '<text x="'+(pl-6)+'" y="'+(yy+4).toFixed(1)+'" font-size="10" fill="#8a928d" text-anchor="end">'+short(val)+'</text>'; }
    if(mn<0&&mx>0) g+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y(0).toFixed(1)+'" y2="'+y(0).toFixed(1)+'" stroke="#c9c3b6" stroke-dasharray="3 3"/>';
    var step=state.h===1?3:(state.h===5?12:24), xl="";
    for(var mm=0;mm<=months;mm+=step) xl+='<text x="'+x(mm).toFixed(1)+'" y="'+(H-6)+'" font-size="10" fill="#8a928d" text-anchor="middle">'+(mm?(state.h===1?mm+"m":(mm/12)+"a"):"hoy")+'</text>';
    return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Evolución de tu dinero">'+g+xl+
      '<path d="'+path(sa)+'" fill="none" stroke="#2f6fdb" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>'+
      '<path d="'+path(sb)+'" fill="none" stroke="#e46f22" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>'+
      '<circle cx="'+x(months)+'" cy="'+y(sa[months])+'" r="4" fill="#2f6fdb"/><circle cx="'+x(months)+'" cy="'+y(sb[months])+'" r="4" fill="#e46f22"/></svg>';
  }

  /* ---------- "IA" (demo con reglas) ---------- */
  var CFG = window.COMPENSA_CONFIG || {};
  var N = window.Nube;
  var COMUNIDADES = ["Andalucía","Aragón","Asturias","Islas Baleares","Canarias","Cantabria","Castilla-La Mancha","Castilla y León",
    "Cataluña","Comunidad Valenciana","Extremadura","Galicia","Comunidad de Madrid","Región de Murcia","Navarra","País Vasco","La Rioja","Ceuta","Melilla"];
  function esPro(){ return !!(state.perfil && state.perfil.pro); }
  function logueado(){ return !!(N && N.configurado() && N.usuario()); }

  /* ---------- Explicación: con reglas (sin cuenta o si falla la IA) ---------- */
  function puntosLocales(R){
    var L=[];
    L.push("Cada mes, con <b>"+esc(R.nA)+"</b> te sobran <b>"+eur(R.a.sobra)+"</b> y con <b>"+esc(R.nB)+"</b> <b>"+eur(R.b.sobra)+"</b> ("+signed(R.b.sobra-R.a.sobra)+").");
    [[R.a,R.nA,state.A],[R.b,R.nB,state.B]].forEach(function(t){
      var s=t[2], r=t[0];
      if(s.tipo!=="padres"){
        var p=Math.round(r.pct*100);
        L.push("En «"+esc(t[1])+"» la vivienda se lleva el <b>"+p+" %</b> de tu sueldo"+(p>30?" (lo recomendable es no pasar del 30 %).":". Está en zona sana."));
      }
      if(s.tipo==="piso"||s.tipo==="habitacion"){
        var e=elig(s);
        if(bonoActivo(s)) L.push("Con el <b>Bono Alquiler Joven</b> recibirías <b>"+eur(r.bonoTotal)+"</b> en «"+esc(t[1])+"». Ojo: dura 2 años, después pagas el alquiler entero.");
        else if(e.ok && !s.bono) L.push("En «"+esc(t[1])+"» podrías pedir el <b>Bono Alquiler Joven</b> (250 €/mes). Actívalo para verlo.");
      }
      if(r.cuota>0) L.push("La hipoteca de «"+esc(t[1])+"» es de <b>"+eur(r.cuota)+"/mes</b>; en "+yrs()+" pagas <b>"+eur(r.intereses)+"</b> de intereses, pero el piso es tuyo (vale unos "+eur(r.asset)+").");
    });
    var g=target(), falta=Math.max(0,g.total-state.ahorro);
    if(falta>0) L.push("Para irte con seguridad te faltan <b>"+eur(falta)+"</b> (entrada + 3 meses de colchón).");
    if(R.a.quiebra>=0||R.b.quiebra>=0) L.push("⚠️ Con alguna opción te quedas sin ahorros: no es buena idea irte todavía con esos números.");
    var concl = !R.win ? "En dinero salen casi igual. Decide por libertad, tiempo de transporte o con quién quieres vivir."
      : "En "+yrs()+", <b>"+esc(R.win==="B"?R.nB:R.nA)+"</b> te deja <b>"+eur(Math.abs(R.diff))+" más</b>. "+
        ((state.A.tipo==="padres"||state.B.tipo==="padres") ? "Quedarse en casa casi siempre ahorra más; la pregunta es si puedes irte <i>sin quedarte sin colchón</i>."
          : "Mira también cuánto del sueldo se va en vivienda: si pasa del 30 %, vas muy justo ante cualquier imprevisto.");
    return "<ul>"+L.map(function(x){return "<li>"+x+"</li>";}).join("")+"</ul><p style='margin:8px 0 0'><b>Conclusión:</b> "+concl+"</p>";
  }
  // Lo que se le manda a la IA: solo números de la simulación, nada personal
  function resumenIA(R){
    function op(s,r,n){ return {nombre:n, donde:TIPOS[s.tipo], sueldo_neto:s.ingresos, vivienda:s.vivienda, otros_gastos:s.gastos,
      pago_inicial:s.inicial, bono_alquiler_joven:bonoActivo(s), hipoteca:s.prestamo, cuota_hipoteca:Math.round(r.cuota),
      precio_piso:s.bien, sobra_al_mes:Math.round(r.sobra), vivienda_pct_sueldo:Math.round(r.pct*100),
      patrimonio_final:Math.round(r.series[r.series.length-1]), se_queda_sin_ahorros_mes:r.quiebra}; }
    var g=target();
    return {edad:state.edad, ahorros:state.ahorro, ahorro_mensual_posible:state.ahorroMes, anos:state.h,
      necesita_para_irse:Math.round(g.total), opcion_a:op(state.A,R.a,R.nA), opcion_b:op(state.B,R.b,R.nB),
      gana:R.win?(R.win==="B"?R.nB:R.nA):"empate", diferencia:Math.round(Math.abs(R.diff)), mes_que_compensa:R.be};
  }
  function textoIA(t){
    // La IA devuelve texto sencillo con párrafos y guiones; se escapa y se le da formato mínimo
    var h=esc(t).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>");
    var bloques=h.split(/\n{2,}/).map(function(b){
      var ls=b.split("\n");
      if(ls.every(function(l){return /^\s*[-•]/.test(l);})) return "<ul>"+ls.map(function(l){return "<li>"+l.replace(/^\s*[-•]\s*/,"")+"</li>";}).join("")+"</ul>";
      return "<p style='margin:6px 0'>"+ls.join("<br>")+"</p>";
    });
    return bloques.join("");
  }
  async function explain(){
    var out=$("aiOut"), R=renderAll();
    if(!logueado()){
      if(state.aiUses>=1){
        out.innerHTML="<p style='margin:6px 0'>Crea tu cuenta gratis para tener <b>3 explicaciones con IA</b> hechas con tus números.</p><button class='btn main' id='aiCuenta'>Crear cuenta gratis</button>";
        out.scrollIntoView({behavior:"smooth",block:"center"}); return;
      }
      state.aiUses++;
      out.innerHTML='<div style="color:var(--muted);font-size:13px">Pensando…</div>';
      setTimeout(function(){
        out.innerHTML=puntosLocales(R)+"<p class='hint' style='margin-top:10px'>Resumen automático. Con una cuenta gratis te lo explica la IA con más detalle.</p>";
        out.scrollIntoView({behavior:"smooth",block:"center"});
      },500);
      return;
    }
    out.innerHTML='<div style="color:var(--muted);font-size:13px">La IA está mirando tus números…</div>';
    out.scrollIntoView({behavior:"smooth",block:"center"});
    try{
      var r=await N.funcion("explicar",{datos:resumenIA(R)},45000);
      out.innerHTML=textoIA(r.texto||"")+"<p class='hint' style='margin-top:10px'>Explicación con IA a partir de tus números. Orientativa, no es asesoramiento financiero."+
        (!esPro()&&typeof r.gratis==="number"?(r.gratis===1?" Te queda 1 explicación gratis.":" Te quedan "+r.gratis+" explicaciones gratis."):"")+"</p>";
      cargarPerfil();
    }catch(e){
      if(e.codigo==="gratis_agotado"){ out.innerHTML=puntosLocales(R)+"<p class='hint' style='margin-top:10px'>Ya has usado tus 3 explicaciones con IA gratis. Con Pro tienes hasta 30 al día.</p>"; openPay(); return; }
      if(e.codigo==="limite"){ out.innerHTML=puntosLocales(R)+"<p class='hint' style='margin-top:10px'>Has llegado al máximo de explicaciones con IA de hoy. Mañana vuelve a estar disponible.</p>"; return; }
      out.innerHTML=puntosLocales(R)+"<p class='hint' style='margin-top:10px'>No se ha podido conectar con la IA ahora mismo, así que te dejamos el resumen automático.</p>";
    }
  }

  /* ---------- Ayudas ---------- */
  var AYUDAS = [
    {tipo:"alquiler", ambito:"Estatal", nombre:"Bono Alquiler Joven", importe:"250 €/mes durante 2 años",
     quien:"De 18 a 35 años, ingresos de hasta 3 veces el IPREM (unos 25.200 € brutos al año) y alquiler de hasta 600 € (piso) o 300 € (habitación); hasta 900 € / 450 € en algunas zonas.",
     donde:"Se pide en tu comunidad autónoma. Cada una abre su propia convocatoria.",
     url:"https://www.mivau.gob.es/vivienda/bono-alquiler-joven", plantilla:"solo", revisada:"2026-11-23"},
    {tipo:"compra", ambito:"Estatal", nombre:"Aval ICO primera vivienda", importe:"Hipoteca de hasta el 100 % del precio",
     quien:"Jóvenes de hasta 35 años y familias con menores a cargo que pueden pagar la cuota pero no tienen ahorrado el 20 % de entrada.",
     donde:"Se pide directamente en los bancos adheridos al pedir la hipoteca.",
     url:"https://www.ico.es/en/linea-avales-hipoteca-primera-vivienda", plantilla:"comprar", revisada:"2026-11-23"}
  ];
  var ayFiltro="todas", ayVistasAntes=null;
  function fechaCorta(d){ try{ return new Date(d).toLocaleDateString("es-ES",{day:"numeric",month:"short",year:"numeric"}); }catch(e){ return ""; } }
  function renderAyudas(){
    var ult=AYUDAS.reduce(function(m,a){ return a.revisada&&a.revisada>m?a.revisada:m; },"");
    $("ayUpd").textContent=ult?"Revisado "+fechaCorta(ult):"";
    var f=[["todas","Todas"],["alquiler","Alquiler"],["compra","Compra"]];
    var com=state.perfil&&state.perfil.comunidad;
    if(com) f.push(["mia",com]);
    $("ayFil").innerHTML=f.map(function(x){return '<button data-ayf="'+esc(x[0])+'" class="'+(ayFiltro===x[0]?"on":"")+'">'+esc(x[1])+'</button>';}).join("");
    var lista=AYUDAS.filter(function(a){
      if(ayFiltro==="mia") return a.ambito==="Estatal"||a.ambito===com;
      return ayFiltro==="todas"||a.tipo===ayFiltro;
    });
    $("ayList").innerHTML=lista.length?lista.map(function(a){
      var nueva = esPro() && ayVistasAntes && a.creada && a.creada>ayVistasAntes;
      var tipoTxt = a.tipo==="alquiler"?"ALQUILER":(a.tipo==="compra"?"COMPRA":"OTRA");
      var url = /^https:\/\//.test(a.url||"") ? a.url : "";
      return '<div class="ay"><div class="top"><span class="tp '+esc(a.tipo)+'">'+tipoTxt+'</span><span>'+(nueva?'<span class="nueva">NUEVA</span> ':'')+'<span class="amb">'+esc(a.ambito||"Estatal")+'</span></span></div>'+
        '<h3>'+esc(a.nombre)+'</h3><div class="imp">'+esc(a.importe)+'</div>'+
        '<p><b>Quién:</b> '+esc(a.quien)+'</p><p><b>Dónde:</b> '+esc(a.donde)+'</p>'+(a.plazo?'<p><b>Plazo:</b> '+esc(a.plazo)+'</p>':'')+
        '<div class="acts">'+(TEMPLATES[a.plantilla]?'<button data-aytpl="'+esc(a.plantilla)+'">Simularla</button>':'')+
        (url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">Ver oficial ↗</a>':'')+'</div></div>';
    }).join(""):'<p class="hint">No hay ayudas en este filtro todavía.</p>';
    $("ayPro").style.display=esPro()?"none":"flex";
  }
  async function cargarAyudas(){
    if(!N||!N.configurado()) return;
    try{ var l=await N.ayudas(); if(Array.isArray(l)&&l.length){ AYUDAS=l; renderAyudas(); } }catch(e){}
  }

  /* ---------- Perfil y cuenta ---------- */
  async function cargarPerfil(){
    if(!logueado()){ state.perfil=null; pintarCabecera(); return; }
    try{
      var p=await N.perfil();
      if(p){ if(ayVistasAntes===null) ayVistasAntes=p.ayudas_vistas||"1970-01-01"; state.perfil=p; }
    }catch(e){ if(!N.usuario()) state.perfil=null; }
    pintarCabecera(); renderAyudas(); renderGoal();
    if(esPro()) setTimeout(function(){ N.marcarAyudasVistas().catch(function(){}); },4000);
  }
  function pintarCabecera(){
    var u=logueado()&&N.usuario();
    $("accBtn").innerHTML = u ? esc((u.email||"Mi cuenta").split("@")[0]) : "Entrar";
    $("proBtn").innerHTML = esPro() ? "✦ Pro ✓" : "✦ Pro";
    $("proCard").style.display = esPro() ? "none" : "block";
  }
  var accModo="entrar", accMsg="", accMsgCls="";
  function abrirCuenta(modo,msg,cls){ if(modo) accModo=modo; accMsg=msg||""; accMsgCls=cls||""; renderCuenta(); $("cuenta").classList.add("show"); }
  function msgHtml(){ return '<div class="msg '+accMsgCls+'" id="accMsg">'+accMsg+'</div>'; }
  function renderCuenta(){
    var b=$("accBody");
    if(!N||!N.configurado()){ b.innerHTML='<h3>Cuenta</h3><p class="hint">Las cuentas no están disponibles todavía.</p>'; return; }
    if(accModo==="nueva"){
      b.innerHTML='<h3>Nueva contraseña</h3>'+
        '<div class="field"><label for="accPass">Contraseña nueva</label><div class="in"><input class="txt" id="accPass" type="password" autocomplete="new-password"></div></div>'+
        msgHtml()+'<button class="btn main" id="accNueva">Guardar contraseña</button>';
      return;
    }
    var u=logueado()&&N.usuario();
    if(!u){
      var reg=accModo==="registro", olv=accModo==="olvido";
      b.innerHTML='<h3>'+(olv?"Recuperar contraseña":(reg?"Crea tu cuenta gratis":"Entra en tu cuenta"))+'</h3>'+
        (olv?'':'<div class="tabs2"><button data-accm="entrar" class="'+(reg?'':'on')+'">Entrar</button><button data-accm="registro" class="'+(reg?'on':'')+'">Crear cuenta</button></div>')+
        (reg?'<p class="hint">Gratis. Guarda una decisión y tienes 3 explicaciones con IA.</p>':'')+
        '<div class="field"><label for="accEmail">Correo</label><div class="in"><input class="txt" id="accEmail" type="email" autocomplete="email" inputmode="email"></div></div>'+
        (olv?'':'<div class="field"><label for="accPass">Contraseña</label><div class="in"><input class="txt" id="accPass" type="password" autocomplete="'+(reg?'new-password':'current-password')+'"></div></div>')+
        msgHtml()+
        '<button class="btn main" id="accGo">'+(olv?"Enviarme un enlace":(reg?"Crear cuenta":"Entrar"))+'</button>'+
        '<p style="text-align:center;margin:12px 0 0">'+(olv?'<button class="lnk" data-accm="entrar">Volver</button>':'<button class="lnk" data-accm="olvido">He olvidado mi contraseña</button>')+'</p>'+
        (reg?'<p class="legal">Al crear la cuenta aceptas las <a href="/terminos/" target="_blank">condiciones</a> y la <a href="/privacidad/" target="_blank">política de privacidad</a>.</p>':'');
      return;
    }
    var p=state.perfil||{};
    var opts='<option value="">Elige tu comunidad</option>'+COMUNIDADES.map(function(c){return '<option'+(p.comunidad===c?' selected':'')+'>'+esc(c)+'</option>';}).join("");
    var estado = p.pro ? 'Compensa Pro activo'+(p.pro_hasta?' hasta el '+fechaCorta(p.pro_hasta):'') : 'Plan gratis · '+(function(n){return n===1?'1 explicación con IA gratis':n+' explicaciones con IA gratis';})(typeof p.ia_gratis==="number"?p.ia_gratis:3);
    b.innerHTML='<h3>Mi cuenta</h3><p style="margin:0 0 4px;font-weight:700">'+esc(u.email||"")+'</p><p class="hint" style="margin:0">'+estado+'</p>'+
      msgHtml()+
      '<div class="acc-sec"><h4>Mis decisiones</h4><div id="decList"><p class="hint">Cargando…</p></div></div>'+
      '<div class="acc-sec"><h4>Mi comunidad autónoma</h4><div class="in"><select id="accCom">'+opts+'</select></div><p class="hint">Para enseñarte las ayudas de tu zona.</p></div>'+
      '<div class="acc-sec"><h4>Suscripción</h4>'+
        (p.pro?(Compra?'<button class="btn soft" id="accGestionar">Gestionar o cancelar suscripción</button>':'<p class="hint">Tu suscripción se gestiona en tu iPhone: Ajustes → tu nombre → Suscripciones.</p>')
          :'<button class="btn main" data-pay>Ver Compensa Pro</button>')+
        (Compra?'<p style="text-align:center;margin:10px 0 0"><button class="lnk" id="accRestaurar">Restaurar compras</button></p>':'')+
      '</div>'+
      '<div class="acc-sec" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><button class="lnk" id="accSalir">Cerrar sesión</button><button class="lnk red" id="accBorrar">Borrar mi cuenta</button></div>';
    pintarDecisiones();
  }
  async function enviarCuenta(){
    var em=($("accEmail")&&$("accEmail").value||"").trim(), pw=$("accPass")?$("accPass").value:"";
    var m=$("accMsg"), btn=$("accGo"); m.className="msg"; m.textContent="";
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ m.className="msg err"; m.textContent="Escribe un correo válido."; return; }
    if(accModo!=="olvido" && pw.length<6){ m.className="msg err"; m.textContent="La contraseña tiene que tener al menos 6 caracteres."; return; }
    btn.disabled=true;
    try{
      if(accModo==="olvido"){ await N.recuperar(em); abrirCuenta("entrar","Te hemos enviado un correo con un enlace para poner una contraseña nueva.","okm"); return; }
      if(accModo==="registro"){
        var r=await N.registrar(em,pw);
        if(r.confirmar){ abrirCuenta("entrar","¡Cuenta creada! Te hemos enviado un correo para confirmarla. Después entra aquí con tu contraseña.","okm"); return; }
      } else await N.entrar(em,pw);
      await cargarPerfil(); abrirCuenta(null,"Has entrado ✓","okm"); toast("Has entrado en tu cuenta");
    }catch(e){ m.className="msg err"; m.textContent=e.message; }
    finally{ if($("accGo")) $("accGo").disabled=false; }
  }

  /* ---------- Decisiones guardadas ---------- */
  function datosActuales(){ return {v:1, tpl:state.tpl, edad:state.edad, ahorro:state.ahorro, rent:state.rent, ahorroMes:state.ahorroMes, h:state.h, A:state.A, B:state.B}; }
  function cargarDatos(d,id){
    if(!d||!d.A||!d.B) return;
    state.tpl=TEMPLATES[d.tpl]?d.tpl:"libre"; state.edad=num(d.edad); state.ahorro=num(d.ahorro); state.rent=num(d.rent);
    state.ahorroMes=num(d.ahorroMes); state.h=[1,5,10].indexOf(d.h)>=0?d.h:5; state.A=sc(d.A); state.B=sc(d.B); state.tab="A"; state.decId=id||null;
    $("edad").value=state.edad; $("ahorro").value=state.ahorro; $("rent").value=state.rent; $("aiOut").innerHTML="";
    renderChips(); renderEditor(); renderAll();
  }
  async function guardarDecision(){
    if(!logueado()){ abrirCuenta("registro","Crea tu cuenta gratis para guardar tus decisiones.",""); return; }
    var btn=$("saveBtn"); btn.disabled=true;
    try{
      var nombre=(state.A.nombre||"A")+" vs "+(state.B.nombre||"B");
      var r=await N.guardarDecision(nombre,datosActuales(),state.decId);
      if(r&&r.id) state.decId=r.id;
      toast("Decisión guardada en tu cuenta ✓"); cargarPerfil();
    }catch(e){
      if(e.codigo==="limite"){ toast("Con el plan gratis puedes guardar 1 decisión"); openPay(); }
      else toast(e.message);
    }finally{ btn.disabled=false; }
  }
  async function pintarDecisiones(){
    var el=$("decList"); if(!el) return;
    try{
      var l=await N.decisiones();
      if(!$("decList")) return;
      el.innerHTML = l.length ? l.map(function(d){
        return '<div class="dec"><div><b>'+esc(d.nombre)+'</b><small>'+fechaCorta(d.actualizado)+'</small></div><div style="display:flex;gap:6px">'+
          '<button class="mini" data-decabrir="'+esc(d.id)+'">Abrir</button><button class="mini del" data-decborrar="'+esc(d.id)+'" aria-label="Borrar">✕</button></div></div>';
      }).join("") : '<p class="hint">Aún no has guardado ninguna. Pulsa «Guardar esta decisión» debajo del resultado.</p>';
      el._lista=l;
    }catch(e){ el.innerHTML='<p class="hint">No se han podido cargar: '+esc(e.message)+'</p>'; }
  }

  /* ---------- Plan de ahorro mes a mes (Pro) ---------- */
  function abrirPlan(){
    if(!esPro()){ openPay(); return; }
    var t=target(), mes=state.ahorroMes, b=$("planBody");
    var falta=Math.max(0,t.total-state.ahorro);
    var h='<h3>📅 Tu plan para irte</h3><p class="hint">Objetivo: <b>'+eur(t.total)+'</b> para «'+esc(t.s.nombre||"irte")+'» (entrada + 3 meses de colchón). Ahorrando <b>'+eur(mes)+'</b> al mes.</p>';
    if(falta<=0){ b.innerHTML=h+'<p><b>Ya tienes lo necesario.</b> Antes de firmar, revisa que el alquiler no pase del 30 % de tu sueldo.</p>'; $("planov").classList.add("show"); return; }
    if(mes<=0){ b.innerHTML=h+'<p>Pon cuánto puedes ahorrar al mes para calcular tu fecha.</p>'; $("planov").classList.add("show"); return; }
    var rows="", acum=state.ahorro, d=new Date(), n=0;
    while(acum<t.total && n<60){ n++; acum+=mes; d.setMonth(d.getMonth()+1);
      var meta=acum>=t.total;
      rows+='<tr'+(meta?' class="meta"':'')+'><td>'+d.toLocaleDateString("es-ES",{month:"short",year:"numeric"})+'</td><td>+'+eur(mes)+'</td><td>'+eur(Math.min(acum,t.total))+(meta?' 🎉':'')+'</td><td>'+Math.min(100,Math.round(acum/t.total*100))+' %</td></tr>'; }
    b.innerHTML=h+(n>=60&&acum<t.total?'<p class="warn" style="display:block">A este ritmo tardarías más de 5 años. Prueba a subir el ahorro mensual o elegir una opción más barata.</p>':'')+
      '<table class="plan-t"><thead><tr><th>Mes</th><th>Ahorras</th><th>Llevas</th><th>Meta</th></tr></thead><tbody>'+rows+'</tbody></table>'+
      '<p class="hint" style="margin-top:12px">Truco: programa una transferencia automática a una cuenta aparte el día que cobras.</p>';
    $("planov").classList.add("show");
  }

  /* ---------- Compensa Pro: compra con Apple (solo en la app de iPhone) ---------- */
  var Compra=(function(){ try{ var C=window.Capacitor; return C&&C.isNativePlatform&&C.isNativePlatform()&&C.getPlatform()==="ios"&&C.registerPlugin?C.registerPlugin("CompraApple"):null; }catch(e){ return null; } })();
  var IDS_APPLE=[CFG.appleMensual||"compensa.mensual", CFG.appleAnual||"compensa.anual"];
  var LEGAL='<p class="legal">Suscripción de renovación automática. Se cobra en tu cuenta de Apple al confirmar y se renueva sola al final de cada periodo salvo que la canceles al menos 24 horas antes, en Ajustes → tu nombre → Suscripciones. '+
    '<a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener">Condiciones de uso (EULA)</a> · <a href="'+esc((CFG.webUrl||"")+"/privacidad/")+'" target="_blank" rel="noopener">Privacidad</a></p>';
  function openPay(){ renderPay(); $("paywall").classList.add("show"); }
  async function confirmarApple(ids){ var r=await N.funcion("apple?accion=verificar",{transacciones:ids},30000); await cargarPerfil(); return r; }
  async function renderPay(){
    var b=$("payBody");
    if(esPro()){ b.innerHTML='<p class="msg okm" style="font-weight:700">Ya tienes Compensa Pro ✓</p>'; return; }
    if(!Compra){
      b.innerHTML='<div class="web-note">Compensa Pro se contrata desde la app de iPhone: <b>'+esc(CFG.precioMensual||"4,99 € al mes")+'</b> o <b>'+esc(CFG.precioAnual||"29,99 € al año")+'</b>, con 7 días gratis. Tu cuenta y tus decisiones son las mismas en la web y en la app.</div>';
      return;
    }
    if(!logueado()){
      b.innerHTML='<p class="hint">Para activar Pro necesitas una cuenta (gratis), así no pierdes tu suscripción si cambias de móvil.</p><button class="btn main" id="payCuenta">Crear cuenta o entrar</button>'+LEGAL;
      return;
    }
    b.innerHTML='<div class="prices-load">Cargando precios de App Store…</div>';
    var ps=[];
    try{ ps=(await Compra.productos({ids:IDS_APPLE})).productos||[]; }catch(e){}
    ps.sort(function(a,c){ return IDS_APPLE.indexOf(c.id)-IDS_APPLE.indexOf(a.id); }); // anual primero
    if(!ps.length){ b.innerHTML='<p class="msg err">No se han podido cargar los precios de App Store. Revisa la conexión e inténtalo de nuevo.</p><button class="btn soft" id="payReintentar">Reintentar</button>'+LEGAL; return; }
    b.innerHTML=ps.map(function(p,i){
      var per=p.periodo==="año"?"año":(p.periodo==="mes"?"mes":p.periodo);
      var prueba=p.prueba?(p.prueba+" "+(p.pruebaUnidad==="dia"?(p.prueba>1?"días":"día"):(p.pruebaUnidad==="semana"?(p.prueba>1?"semanas":"semana"):p.pruebaUnidad))+" gratis"):"";
      return '<div class="plan'+(i===0?' on':'')+'" data-plan="'+esc(p.id)+'"><div><b>'+(per==="año"?"Anual":"Mensual")+'</b><small>'+(prueba?esc(prueba)+" · ":"")+(per==="año"?"Lo más barato":"Cancela cuando quieras")+'</small></div><div class="p">'+esc(p.precio)+'<small>/'+esc(per)+'</small></div></div>';
    }).join("")+'<button class="btn main" id="payComprar" style="margin-top:6px">Continuar</button><div class="msg" id="payMsg"></div>'+
      '<p style="text-align:center;margin:6px 0 0"><button class="lnk" id="payRestaurar">Restaurar compras</button></p>'+LEGAL;
  }
  async function comprar(){
    var sel=document.querySelector("#payBody .plan.on"), m=$("payMsg"), btn=$("payComprar");
    if(!sel||!logueado()) return;
    btn.disabled=true; m.className="msg"; m.textContent="Abriendo App Store…";
    try{
      var r=await Compra.comprar({id:sel.getAttribute("data-plan"), cuenta:N.usuario().id});
      if(r.estado==="ok"){ m.textContent="Activando tu suscripción…"; await confirmarApple([r.transactionId]); toast("¡Compensa Pro activado!"); $("paywall").classList.remove("show"); return; }
      m.textContent = r.estado==="pendiente" ? "La compra está pendiente de aprobación. Se activará sola cuando Apple la confirme." : "";
    }catch(e){ m.className="msg err"; m.textContent=e.message||"No se ha podido completar la compra."; }
    finally{ if($("payComprar")) $("payComprar").disabled=false; }
  }
  async function restaurar(destino){
    var m=destino; if(m){ m.className="msg"; m.textContent="Buscando tus compras…"; }
    try{
      var c=(await Compra.restaurar()).compras||[];
      if(!c.length){ if(m) m.textContent="No hay ninguna suscripción activa con este Apple ID."; return; }
      var r=await confirmarApple(c.map(function(x){return x.transactionId;}));
      if(m){ m.className="msg "+(r.estado==="active"?"okm":""); m.textContent=r.estado==="active"?"Suscripción restaurada ✓":"Tu suscripción de Apple no está activa."; }
      if(r.estado==="active") renderPay();
    }catch(e){ if(m){ m.className="msg err"; m.textContent=e.message; } }
  }
  if(Compra) Compra.addListener("transaccion",function(d){ if(logueado()&&d&&d.transactionId) confirmarApple([d.transactionId]).catch(function(){}); });

  function toast(t){ var e=$("toast"); e.textContent=t; e.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(function(){e.classList.remove("show");},2800); }

  /* ---------- eventos ---------- */
  document.addEventListener("click",function(e){
    var el=e.target.closest("[data-ayf],[data-aytpl],[data-accm],[data-decabrir],[data-decborrar],[data-close]");
    if(el){
      if(el.hasAttribute("data-close")){ el.closest(".ov").classList.remove("show"); return; }
      if(el.hasAttribute("data-ayf")){ ayFiltro=el.getAttribute("data-ayf"); renderAyudas(); return; }
      if(el.hasAttribute("data-aytpl")){ loadTpl(el.getAttribute("data-aytpl")); state.tab="B"; renderEditor(); $("editor").scrollIntoView({behavior:"smooth",block:"start"}); toast("Ayuda cargada en el simulador"); return; }
      if(el.hasAttribute("data-accm")){ accModo=el.getAttribute("data-accm"); accMsg=""; renderCuenta(); return; }
      if(el.hasAttribute("data-decabrir")){ var l=($("decList")||{})._lista||[], id=el.getAttribute("data-decabrir");
        var d=l.filter(function(x){return x.id===id;})[0]; if(d){ cargarDatos(d.datos,d.id); $("cuenta").classList.remove("show"); toast("Decisión cargada"); window.scrollTo({top:0,behavior:"smooth"}); } return; }
      if(el.hasAttribute("data-decborrar")){ var idb=el.getAttribute("data-decborrar");
        if(el.getAttribute("data-ok")!=="1"){ el.setAttribute("data-ok","1"); el.textContent="¿Borrar?"; return; }
        N.borrarDecision(idb).then(function(){ if(state.decId===idb) state.decId=null; pintarDecisiones(); cargarPerfil(); }).catch(function(err){ toast(err.message); }); return; }
    }
    var t=e.target.closest("[data-tpl],[data-tab],[data-h],[data-pay],[data-plan],#brutoLink,#bApply,#explainBtn,#paywall,#cuenta,#planov,#accBtn,#accGo,#accNueva,#accSalir,#accBorrar,#accGestionar,#accRestaurar,#saveBtn,#planBtn,#aiCuenta,#payCuenta,#payReintentar,#payComprar,#payRestaurar");
    if(!t) return;
    if(t.hasAttribute("data-tpl")) loadTpl(t.getAttribute("data-tpl"));
    else if(t.hasAttribute("data-tab")){ state.tab=t.getAttribute("data-tab"); renderEditor(); }
    else if(t.hasAttribute("data-h")){ state.h=+t.getAttribute("data-h"); renderResults(); }
    else if(t.hasAttribute("data-pay")){ $("cuenta").classList.remove("show"); openPay(); }
    else if(t.hasAttribute("data-plan")) document.querySelectorAll("#payBody .plan").forEach(function(p){p.classList.toggle("on",p===t);});
    else if(t.id==="brutoLink"){ $("bruto").classList.toggle("show"); updateBruto(); }
    else if(t.id==="bApply"){ var r=netoDesdeBruto(num($("bAnual").value)); state[state.tab].ingresos=Math.round(r.neto/12); renderEditor(); renderAll(); toast("Neto aplicado: "+eur(r.neto/12)+"/mes"); }
    else if(t.id==="explainBtn") explain();
    else if((t.id==="paywall"||t.id==="cuenta"||t.id==="planov") && e.target===t) t.classList.remove("show");
    else if(t.id==="accBtn") abrirCuenta(logueado()?null:"entrar");
    else if(t.id==="accGo") enviarCuenta();
    else if(t.id==="accNueva"){ var pw=$("accPass").value, m=$("accMsg");
      if(pw.length<6){ m.className="msg err"; m.textContent="Mínimo 6 caracteres."; return; }
      N.cambiarClave(pw).then(function(){ accModo="entrar"; return cargarPerfil(); }).then(function(){ abrirCuenta(null,"Contraseña cambiada ✓","okm"); }).catch(function(err){ m.className="msg err"; m.textContent=err.message; }); }
    else if(t.id==="accSalir"){ N.salir().then(function(){ state.perfil=null; state.decId=null; ayVistasAntes=null; pintarCabecera(); renderAyudas(); renderGoal(); $("cuenta").classList.remove("show"); toast("Has cerrado sesión"); }); }
    else if(t.id==="accBorrar"){
      if(t.getAttribute("data-ok")!=="1"){ t.setAttribute("data-ok","1"); t.textContent="Pulsa otra vez para borrarla para siempre"; return; }
      N.borrarCuenta().then(function(){ state.perfil=null; state.decId=null; pintarCabecera(); renderAyudas(); $("cuenta").classList.remove("show");
        toast(Compra?"Cuenta borrada. Si tenías Pro, cancélalo también en Ajustes → tu nombre → Suscripciones.":"Tu cuenta se ha borrado"); })
        .catch(function(err){ toast(err.message); }); }
    else if(t.id==="accGestionar"&&Compra) Compra.gestionar().catch(function(){});
    else if(t.id==="accRestaurar"&&Compra) restaurar($("accMsg"));
    else if(t.id==="saveBtn") guardarDecision();
    else if(t.id==="planBtn") abrirPlan();
    else if(t.id==="aiCuenta"||t.id==="payCuenta"){ $("paywall").classList.remove("show"); abrirCuenta("registro"); }
    else if(t.id==="payReintentar") renderPay();
    else if(t.id==="payComprar") comprar();
    else if(t.id==="payRestaurar") restaurar($("payMsg"));
  });
  document.addEventListener("change",function(e){
    var el=e.target;
    if(el.id==="bonoChk"){ state[state.tab].bono=el.checked; renderEditor(); renderAll(); }
    else if(el.tagName==="SELECT" && el.getAttribute("data-k")==="tipo"){ var s=state[state.tab]; s.tipo=el.value; if(s.tipo==="padres"){s.bono=false;} renderEditor(); renderAll(); }
    else if(el.id==="accCom"){ var c=el.value; N.guardarComunidad(c).then(function(){ if(state.perfil) state.perfil.comunidad=c; ayFiltro=c?"mia":"todas"; renderAyudas(); toast("Comunidad guardada"); }).catch(function(err){ toast(err.message); }); }
  });
  document.addEventListener("input",function(e){
    var el=e.target;
    if(el.id==="edad"){ state.edad=num(el.value); renderEditor(); renderAll(); }
    else if(el.id==="ahorro"){ state.ahorro=num(el.value); renderAll(); }
    else if(el.id==="rent"){ state.rent=num(el.value); renderResults(); }
    else if(el.id==="ahorroMes"){ state.ahorroMes=num(el.value); var pos=el.selectionStart; renderGoal(); var n=$("ahorroMes"); n.focus(); try{n.setSelectionRange(pos,pos);}catch(_){} }
    else if(el.id==="bAnual"||el.id==="bPagas") updateBruto();
    else if(el.hasAttribute("data-k") && el.tagName!=="SELECT"){
      var k=el.getAttribute("data-k");
      state[state.tab][k] = k==="nombre" ? el.value : num(el.value);
      if(k==="vivienda"||k==="ingresos"){ var bb=$("bonoBox"); if(bb){ var tmp=document.createElement("div"); tmp.innerHTML=bonoBox(state[state.tab]); bb.replaceWith(tmp.firstChild); } }
      renderAll();
    }
  });
  document.addEventListener("keydown",function(e){ if(e.key==="Enter"&&e.target&&(e.target.id==="accEmail"||e.target.id==="accPass")){ var g=$("accGo")||$("accNueva"); if(g) g.click(); } });

  /* ---------- arranque ---------- */
  renderAyudas();
  loadTpl("solo");
  pintarCabecera();
  if(N&&N.configurado()){
    var enlace=N.sesionDesdeEnlace();
    if(enlace&&enlace.error) toast("El enlace no es válido o ha caducado. Pide otro.");
    N.completarUsuario().then(function(){
      if(enlace&&enlace.tipo==="recovery") abrirCuenta("nueva","Escribe tu nueva contraseña.","");
      else if(enlace&&enlace.tipo) toast("¡Correo confirmado! Ya has entrado en tu cuenta.");
      return cargarPerfil();
    }).catch(function(){});
    cargarAyudas();
  }
})();
