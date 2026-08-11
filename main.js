// ==UserScript==
// @name         GeoFS VDGS - ADB SAFEGATE Safedock
// @namespace    https://geo-fs.com/
// @version      1.4.0
// @description  Lightweight Safedock + Wing Camera toggle (C / click)
// @author       chi_FUK77W
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';

const CAPTURE=110, TRACK=55, CLOSE=40, STOP=0, TOO_FAR=-2, LAT_OK=0.65;
const UPDATE=50, ALT_MS=1500, OK_MS=5000, GATE_OFF=30;
const GATES_URL='https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/refs/heads/main/gates.json';

let dock=null, armed=false, altToggle=false, lastAlt=0, stopAt=null, gates={};
let wingMode=-1, prevCam=-1, miniOn=false;
let $ = {}; // DOM cache

const rad = d => d*Math.PI/180;
const deg = r => r*180/Math.PI;
const fix360 = a => ((a%360)+360)%360;

function relToDock(lat,lon,dLat,dLon,hdg){
  const R=6371000, dLa=rad(lat-dLat), dLo=rad(lon-dLon), mLat=rad((lat+dLat)/2);
  const n=dLa*R, e=dLo*R*Math.cos(mLat), h=rad(hdg);
  return {along:-(n*Math.cos(h)+e*Math.sin(h)), cross:-n*Math.sin(h)+e*Math.cos(h), dist:Math.hypot(n,e)};
}
function geoDist(a,b,c,d){
  const R=6371000, dLa=rad(c-a), dLo=rad(d-b), m=rad((a+c)/2);
  return Math.hypot(dLa*R, dLo*R*Math.cos(m));
}
function offset(lat,lon,hdg,dist){
  const h=rad(hdg), R=6371000;
  return {lat:lat+deg((-dist*Math.cos(h))/R), lon:lon+deg((-dist*Math.sin(h))/(R*Math.cos(rad(lat))))};
}
function getAC(){
  const ac=geofs?.aircraft?.instance;
  if(!ac?.llaLocation) return null;
  const an=geofs.animation?.values;
  return {
    lat:ac.llaLocation[0], lon:ac.llaLocation[1],
    hdg:an?.heading360 ?? (ac.htr ? fix360(ac.htr[0]) : 0),
    gs:an?.groundSpeedKnt||0
  };
}
function cleanName(n){
  if(!n) return {base:'ACFT',suf:null};
  n=n.toUpperCase().replace(/BOEING\s*|AIRBUS\s*/g,'').replace(/[^A-Z0-9\-]/g,'').slice(0,12);
  if(n.includes('A350')) return {base:'A350',suf:'-900'};
  if(n.includes('777')) n=n.replace(/ER/g,'').replace(/--+/g,'-').replace(/^-|-$/g,'');
  const p=n.split('-');
  return {base:p[0]||n, suf:p.length>1?'-'+p.slice(1).join('-'):null};
}
function isTarget(){
  try{
    const n=(geofs.aircraft.instance.aircraftRecord?.name||geofs.aircraft.instance.name||'').toUpperCase();
    return n.includes('A350') || (n.includes('777') && (n.includes('300')||n.includes('300ER')));
  }catch{return false}
}
function findWing(){
  wingMode=-1;
  if(!isTarget()||!geofs?.camera?.modes) return -1;
  let exact=-1, best=-1;
  for(let i=0;i<geofs.camera.modes.length;i++){
    const name=(geofs.camera.modes[i].name||geofs.camera.modes[i].view||'').toLowerCase().trim();
    if(name.includes('wing2')||name.includes('wing 2')||(name.includes('wing')&&/\b2\b/.test(name))) continue;
    if(name==='wing'){exact=i;break}
    if(name.includes('wing')&&best<0) best=i;
  }
  return wingMode = exact>=0 ? exact : best;
}
function toggleWing(){
  const idx=findWing();
  if(idx<0||!geofs?.camera) return;
  if(geofs.camera.currentMode===idx){
    if(prevCam>=0 && prevCam!==idx) geofs.camera.set(prevCam);
  }else{
    prevCam=geofs.camera.currentMode;
    geofs.camera.set(idx);
    setTimeout(()=>{if(geofs.camera.currentMode!==idx) geofs.camera.set(idx)},60);
  }
}

function injectCSS(){
  if(document.getElementById('vdgs-s')) return;
  const l=document.createElement('link');
  l.rel='stylesheet'; l.href='https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
  document.head.appendChild(l);
  const s=document.createElement('style'); s.id='vdgs-s';
  s.textContent=`
#vdgs{position:fixed;top:65px;right:18px;width:210px;background:#0a0a0a;border:3px solid #1c1c1c;border-radius:8px;box-shadow:0 12px 40px #000c;z-index:99999;overflow:hidden;font-family:'Press Start 2P',monospace;user-select:none}
#vdgs.hd{background:#151515;padding:5px 9px;font-size:8px;color:#555;display:flex;justify-content:space-between;align-items:center;cursor:move;border-bottom:1px solid #222;font-family:sans-serif}
#vdgs.hd button{background:0;border:0;color:#777;font-size:13px;cursor:pointer}
#vdgs.sc{background:#000;padding:14px 10px 16px;text-align:center}
#vdgs.sl{font-size:13px;color:#ffcc00;text-shadow:0 0 10px #ffaa00;min-height:18px;letter-spacing:2px;margin-bottom:2px;opacity:0;transition:opacity .12s}
#vdgs.sl.on{opacity:1}
#vdgs.ty{font-size:22px;color:#ffb000;letter-spacing:1px;text-shadow:0 0 10px #ffb000cc;min-height:36px;line-height:1.3}
#vdgs.gd{position:relative;height:118px;display:flex;justify-content:center;align-items:center}
#vdgs.tw{display:none;position:absolute;left:50%;top:8px;transform:translateX(-50%);flex-direction:column;align-items:center}
#vdgs.tt{width:52px;height:10px;background:#ffb000;box-shadow:0 0 14px #ff8800}
#vdgs.ts{width:12px;background:#ffb000;box-shadow:0 0 14px #ff8800;transition:height .05s linear;margin-top:-1px}
#vdgs.pa{color:#ffb000;font-size:16px;text-shadow:0 0 11px #ff8800;margin-top:4px;transition:transform .06s linear}
#vdgs.fl{display:none;color:#ffb000;font-size:20px;text-shadow:0 0 12px #ff8800;animation:fm 1.1s ease-in-out infinite}
.sa{position:absolute;top:28px;font-size:22px;color:#ff1a00;text-shadow:0 0 12px red;opacity:0;transition:opacity .08s}
.sa.on{opacity:1;animation:bl .36s infinite}
#vdgs.lf{left:8px}#vdgs.rt{right:8px}
#vdgs.st{display:none;width:118px;height:118px;background:#000;color:#ff1a00;font-size:20px;border:6px solid #ff1a00;box-sizing:border-box;clip-path:polygon(30% 0%,70% 0%,100% 30%,100% 70%,70% 100%,30% 100%,0% 70%,0% 30%);align-items:center;justify-content:center;margin:0 auto;box-shadow:0 0 20px #ff1a00b3;text-shadow:0 0 8px #ff1a00;line-height:1}
#vdgs.ms{font-size:16px;letter-spacing:2px;min-height:28px;margin-top:6px;text-shadow:0 0 10px currentColor}
#vdgs.ms.ok{color:#ffcc00}#vdgs.ms.info{color:#ffb000}
#vdgs.ss{font-size:8px;color:#444;margin-top:6px;font-family:sans-serif}
#vdgs.ct{display:flex;gap:3px;padding:5px;background:#0d0d0d;border-top:1px solid #1a1a1a}
#vdgs.ct button{flex:1;background:#1a1a1a;border:1px solid #2a2a2a;color:#999;padding:6px 0;font-size:8px;cursor:pointer;border-radius:3px;font-family:sans-serif}
#vdgs.ct button:hover{background:#252525}#vdgs.ct button.ac{background:#0a3d0a;border-color:#1a7a1a;color:#6f6}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.1}}
@keyframes fm{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
#vdgs.in .sc{opacity:.25}
#mp{position:fixed;bottom:24px;left:24px;width:200px;height:110px;background:#0a0a0a;border:3px solid #ffb000;border-radius:8px;box-shadow:0 8px 30px #000a;z-index:99998;display:none;font-family:'Press Start 2P',monospace;cursor:pointer;overflow:hidden;user-select:none}
#mp .h{background:#151515;padding:5px 9px;font-size:9px;color:#ffb000;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #333;font-family:sans-serif}
#mp .b{height:calc(100% - 26px);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#ffb000;text-align:center;padding:6px}
#mp .t{font-size:11px;margin-bottom:6px;text-shadow:0 0 8px #ff8800}
#mp .i{font-size:8px;color:#aaa;font-family:sans-serif;line-height:1.35}
#mp:hover{border-color:#ffcc00;box-shadow:0 0 18px #ffb00066}`;
  document.head.appendChild(s);
}

function drag(el,handle){
  let ox,oy,on=false;
  handle.onmousedown=e=>{on=true;ox=e.clientX-el.offsetLeft;oy=e.clientY-el.offsetTop;e.preventDefault()};
  document.onmousemove=e=>{if(!on)return;el.style.left=e.clientX-ox+'px';el.style.top=e.clientY-oy+'px';el.style.right=el.style.bottom='auto'};
  document.onmouseup=()=>on=false;
}

function createUI(){
  if(document.getElementById('vdgs')) return;
  injectCSS();
  const p=document.createElement('div');
  p.id='vdgs'; p.className='in';
  p.innerHTML=`
<div class="hd"><span>ADB SAFEGATE · SAFEDOCK</span><button id="vdgs-x">−</button></div>
<div class="sc">
  <div class="sl" id="vdgs-sl"></div>
  <div class="ty" id="vdgs-ty">----</div>
  <div class="gd">
    <div class="sa" id="vdgs-lf"></div>
    <div class="fl" id="vdgs-fl">▲▲▲</div>
    <div class="tw" id="vdgs-tw">
      <div class="tt"></div>
      <div class="ts" id="vdgs-ts" style="height:72px"></div>
      <div class="pa" id="vdgs-pa">↑</div>
    </div>
    <div class="st" id="vdgs-st">STOP</div>
    <div class="sa" id="vdgs-rt"></div>
  </div>
  <div class="ms info" id="vdgs-ms"></div>
  <div class="ss" id="vdgs-ss">SET STOP / SET GATE</div>
</div>
<div class="ct">
  <button id="vdgs-set">SET STOP</button>
  <button id="vdgs-gate">SET GATE</button>
  <button id="vdgs-arm">ARM</button>
  <button id="vdgs-clr">CLEAR</button>
</div>`;
  document.body.appendChild(p);

  const mp=document.createElement('div');
  mp.id='mp';
  mp.innerHTML=`<div class="h"><span>WING CAMERA</span><span style="opacity:.5">●</span></div>
<div class="b"><div class="t">WING VIEW</div><div class="i">C or Click to toggle</div></div>`;
  document.body.appendChild(mp);

  // DOM cache
  $={
    p, mp,
    sl:document.getElementById('vdgs-sl'),
    ty:document.getElementById('vdgs-ty'),
    fl:document.getElementById('vdgs-fl'),
    tw:document.getElementById('vdgs-tw'),
    ts:document.getElementById('vdgs-ts'),
    pa:document.getElementById('vdgs-pa'),
    st:document.getElementById('vdgs-st'),
    lf:document.getElementById('vdgs-lf'),
    rt:document.getElementById('vdgs-rt'),
    ms:document.getElementById('vdgs-ms'),
    ss:document.getElementById('vdgs-ss'),
    arm:document.getElementById('vdgs-arm')
  };

  drag(p, p.querySelector('.hd'));
  drag(mp, mp.querySelector('.h'));
  mp.onclick=toggleWing;

  document.getElementById('vdgs-x').onclick=()=>p.style.display=p.style.display==='none'?'block':'none';
  document.getElementById('vdgs-set').onclick=setStop;
  document.getElementById('vdgs-gate').onclick=setGate;
  document.getElementById('vdgs-arm').onclick=toggleArm;
  document.getElementById('vdgs-clr').onclick=clearDock;

  window.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    if(e.shiftKey&&(e.key==='V'||e.key==='v')){e.preventDefault();setStop();return}
    if(!e.shiftKey&&!e.ctrlKey&&!e.altKey){
      if(e.key==='q'||e.key==='Q'){e.preventDefault();p.style.display=p.style.display==='none'?'block':'none';return}
      if(e.key==='c'||e.key==='C'){e.preventDefault();toggleWing();return}
    }
  });
}

function setStop(){
  const ac=getAC(); if(!ac) return alert('機体準備できていません');
  dock={lat:ac.lat,lon:ac.lon,heading:ac.hdg};
  armed=true; stopAt=null;
  $.arm.textContent='ARMED'; $.arm.classList.add('ac');
  $.p.classList.remove('in');
  $.ss.textContent=`Stop ${ac.lat.toFixed(5)} ${Math.round(ac.hdg)}°`;
  findWing();
}
function setGate(){
  const ac=getAC(); if(!ac) return alert('機体準備できていません');
  if(!Object.keys(gates).length) return alert('Gates未読込');
  const input=prompt('ゲート番号（例:21 / A12 / 209R）'); if(input===null) return;
  const q=input.trim().toLowerCase(); if(!q) return alert('未入力');
  let nearest=null, minD=1e9;
  for(const icao in gates) for(const g of gates[icao]||[]){
    if(typeof g.lat!=='number'||!g.name?.toLowerCase().includes(q)) continue;
    const d=geoDist(ac.lat,ac.lon,g.lat,g.lon);
    if(d<minD){minD=d;nearest={icao,g}}
  }
  if(!nearest) return alert(`「${input}」なし`);
  if(minD>800&&!confirm(`${nearest.g.name} ${Math.round(minD)}m先。セット？`)) return;
  const off=offset(nearest.g.lat,nearest.g.lon,nearest.g.heading||0,GATE_OFF);
  dock={lat:off.lat,lon:off.lon,heading:nearest.g.heading||0};
  armed=true; stopAt=null;
  $.arm.textContent='ARMED'; $.arm.classList.add('ac');
  $.p.classList.remove('in');
  $.ss.textContent=`${nearest.icao} ${nearest.g.name} 30m手前 ${Math.round(nearest.g.heading||0)}°`;
  findWing();
}
function toggleArm(){
  if(!dock) return alert('先にSETしてください');
  armed=!armed;
  if(!armed) stopAt=null;
  $.arm.textContent=armed?'ARMED':'ARM';
  $.arm.classList.toggle('ac',armed);
  $.p.classList.toggle('in',!armed);
}
function clearDock(){
  dock=null; armed=false; stopAt=null; prevCam=-1;
  $.arm.textContent='ARM'; $.arm.classList.remove('ac');
  $.p.classList.add('in');
  $.ty.textContent='----';
  $.sl.textContent=''; $.sl.classList.remove('on');
  $.ms.textContent=''; $.ms.className='ms info';
  $.ts.style.height='72px';
  $.pa.style.transform='translateX(0)';
  $.lf.classList.remove('on'); $.rt.classList.remove('on');
  $.fl.style.display='none'; $.tw.style.display='none'; $.st.style.display='none';
  $.ss.textContent='SET STOP / SET GATE';
  hideMini();
}
function showMini(){ if(!miniOn){$.mp.style.display='block';miniOn=true} }
function hideMini(){ if(miniOn){$.mp.style.display='none';miniOn=false} }

function update(){
  if(!armed||!dock){hideMini();return}
  const ac=getAC(); if(!ac) return;
  const r=relToDock(ac.lat,ac.lon,dock.lat,dock.lon,dock.heading);
  const {along,cross,dist}=r;
  const now=Date.now();

  // type display
  let info={base:'ACFT',suf:null};
  try{if(geofs.aircraft.instance.aircraftRecord) info=cleanName(geofs.aircraft.instance.aircraftRecord.name)}catch{}
  if(now-lastAlt>ALT_MS){altToggle=!altToggle;lastAlt=now}
  const disp=info.suf&&altToggle?info.suf:info.base;

  $.ty.textContent=disp;
  $.sl.textContent=''; $.sl.classList.remove('on');

  // mini player
  if(dist<=50 && along>TOO_FAR-10){
    if(wingMode<0) findWing();
    wingMode>=0 ? showMini() : hideMini();
  }else hideMini();

  if(dist>CAPTURE || along<TOO_FAR-25){
    $.ty.textContent='----';
    $.fl.style.display=$.tw.style.display=$.st.style.display='none';
    $.lf.classList.remove('on'); $.rt.classList.remove('on');
    stopAt=null; $.ss.textContent='Out of range';
    return;
  }

  const needL=Math.abs(cross)>LAT_OK&&cross>0;
  const needR=Math.abs(cross)>LAT_OK&&cross<0;
  $.st.style.display='none';

  if(along>TRACK){
    $.fl.style.display='block';
    $.tw.style.display='none';
    $.ms.textContent=''; $.ms.className='ms info';
    $.lf.classList.remove('on'); $.rt.classList.remove('on');
    stopAt=null;
  }else{
    $.fl.style.display='none';
    if(along<=STOP){
      $.tw.style.display='none';
      $.lf.classList.remove('on'); $.rt.classList.remove('on');
      if(stopAt===null) stopAt=now;
      if(Math.abs(cross)<LAT_OK*1.3 && ac.gs<2 && (now-stopAt)>=OK_MS){
        $.st.style.display='none';
        $.ms.textContent='OK'; $.ms.className='ms ok';
      }else{
        $.st.style.display='flex';
        $.ms.textContent=''; $.ms.className='ms info';
      }
    }else{
      stopAt=null;
      $.tw.style.display='flex';
      $.lf.classList.toggle('on',needL);
      $.rt.classList.toggle('on',needR);
      const off=Math.max(-34,Math.min(34,(cross/5.5)*34));
      $.pa.style.transform=`translateX(${off}px)`;
      let h=72;
      if(along<=CLOSE) h=Math.max(1,((along-STOP)/(CLOSE-STOP))*72);
      $.ts.style.height=h+'px';
      if(along<30){
        $.ty.textContent=along.toFixed(1)+'m';
        if(ac.gs>=5){$.sl.textContent='SLOW';$.sl.classList.add('on')}
      }
      $.ms.textContent=''; $.ms.className='ms info';
    }
  }
  $.ss.textContent=`XTE ${cross>=0?'R':'L'}${Math.abs(cross).toFixed(1)} ${ac.gs|0}kt`;
}

function wait(cb){
  const t=setInterval(()=>{if(geofs?.aircraft?.instance?.llaLocation){clearInterval(t);cb()}},300);
}
wait(()=>{
  createUI();
  fetch(GATES_URL).then(r=>r.json()).then(d=>gates=d||{}).catch(()=>{});
  setInterval(update,UPDATE);
});
})();さ
