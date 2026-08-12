// ==UserScript==
// @name         GeoFS VDGS - ADB SAFEGATE Safedock
// @namespace    https://geo-fs.com/
// @version      1.3.4
// @description  ADB SAFEGATE Safedock + Wing Camera Mini Player (A350 / 777-300ER) - VT323 / Toggle (Click+Enter)
// @author       chi_FUK77W
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function(){
'use strict';
const CAPTURE_DIST=110,TRACK_DIST=55,CLOSE_DIST=40,STOP_DIST=0,TOO_FAR=-2,LATERAL_OK=0.65,UPDATE_MS=50,ALTERNATE_MS=1500,OK_DELAY_MS=5000,GATE_OFFSET=30;
const GATES_URL='https://raw.githubusercontent.com/machpoint82/geofs-gate-spawner/refs/heads/main/gates.json';
let dock=null,armed=false,alternateToggle=false,lastAlternateTime=0,stopEnteredAt=null,gatesDB={};
let wingCamMode=-1,miniPlayerVisible=false;
let previousCamMode = -1;

function toRad(d){return d*Math.PI/180}
function toDeg(r){return r*180/Math.PI}
function fix360(a){return((a%360)+360)%360}
function relativeToDock(acLat,acLon,dockLat,dockLon,dockHdg){
const R=6371000,dLat=toRad(acLat-dockLat),dLon=toRad(acLon-dockLon),meanLat=toRad((acLat+dockLat)/2);
const north=dLat*R,east=dLon*R*Math.cos(meanLat),h=toRad(dockHdg);
return{along:-(north*Math.cos(h)+east*Math.sin(h)),cross:-north*Math.sin(h)+east*Math.cos(h),dist:Math.hypot(north,east)};
}
function geoDistMeters(lat1,lon1,lat2,lon2){
const R=6371000,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1),meanLat=toRad((lat1+lat2)/2);
return Math.hypot(dLat*R,dLon*R*Math.cos(meanLat));
}
function offsetPoint(lat,lon,heading,dist){
const h=toRad(heading),R=6371000;
return{lat:lat+toDeg((-dist*Math.cos(h))/R),lon:lon+toDeg((-dist*Math.sin(h))/(R*Math.cos(toRad(lat))))};
}
function getAircraft(){
if(!window.geofs?.aircraft?.instance)return null;
const ac=geofs.aircraft.instance,anim=geofs.animation?.values;
return{lat:ac.llaLocation[0],lon:ac.llaLocation[1],hdg:anim?.heading360??(ac.htr?fix360(ac.htr[0]):0),gs:anim?.groundSpeedKnt||0};
}
function cleanTypeName(name){
if(!name)return{base:'ACFT',suffix:null};
let n=name.toUpperCase().trim();
if(n.includes('BOEING')){n=n.replace(/BOEING\s*/i,'').replace(/[^A-Z0-9\-]/g,'');if(/^[0-9]/.test(n))n='B'+n;}
else if(n.includes('AIRBUS'))n=n.replace(/AIRBUS\s*/i,'').replace(/[^A-Z0-9\-]/g,'');
else n=n.replace(/[^A-Z0-9\-]/g,'');
n=n.substring(0,12);
if(n.includes('A350'))return{base:'A350',suffix:'-900'};
if(n.includes('777'))n=n.replace(/ER/g,'').replace(/--+/g,'-').replace(/^-|-$/g,'');
const p=n.split('-');
return{base:p[0]||n,suffix:p.length>1?'-'+p.slice(1).join('-'):null};
}
function loadGates(){fetch(GATES_URL).then(r=>r.json()).then(d=>gatesDB=d||{}).catch(()=>gatesDB={});}

function isTargetAircraft(){
    try{
        const rec = geofs.aircraft?.instance?.aircraftRecord;
        const name = (rec?.name || geofs.aircraft.instance.name || '').toUpperCase();
        if(name.includes('A350')) return true;
        if(name.includes('777') && (name.includes('300') || name.includes('300ER'))) return true;
        return false;
    }catch(e){
        return false;
    }
}

function findWingCamera(){
    wingCamMode = -1;
    if(!isTargetAircraft()) return -1;
    if(!geofs?.camera?.modes || !geofs.camera.modes.length) return -1;

    let exact = -1;
    let best = -1;

    for(let i = 0; i < geofs.camera.modes.length; i++){
        const mode = geofs.camera.modes[i];
        const raw = (mode.name || mode.view || '').toString();
        const name = raw.toLowerCase().trim();

        if(name.includes('wing2') || name.includes('wing 2') ||
           (name.includes('wing') && /\b2\b/.test(name))) continue;

        if(name === 'wing'){
            exact = i;
            break;
        }
        if(name.includes('wing') && best === -1){
            best = i;
        }
    }

    wingCamMode = exact !== -1 ? exact : best;
    return wingCamMode;
}

function toggleWingCamera(){
    const idx = findWingCamera();
    if(idx < 0 || !geofs?.camera){
        console.warn('[VDGS] Wing camera not found.');
        return;
    }

    if(geofs.camera.currentMode === idx){
        if(previousCamMode >= 0 && previousCamMode !== idx){
            geofs.camera.set(previousCamMode);
        }
    } else {
        previousCamMode = geofs.camera.currentMode;
        geofs.camera.set(idx);
        setTimeout(() => {
            if(geofs.camera.currentMode !== idx) geofs.camera.set(idx);
        }, 80);
    }
}

function injectCSS(){
    // 古いスタイルを完全削除
    const old = document.getElementById('vdgs-style');
    if(old) old.remove();

    // フォント読み込み（重複防止）
    if(!document.getElementById('vdgs-font-vt323')){
        const f = document.createElement('link');
        f.id = 'vdgs-font-vt323';
        f.rel = 'stylesheet';
        f.href = 'https://fonts.googleapis.com/css2?family=VT323&display=swap';
        document.head.appendChild(f);
    }

    const s = document.createElement('style');
    s.id = 'vdgs-style';
    s.textContent = `
#vdgs-panel{
    position:fixed;top:65px;right:18px;width:220px;
    background:#0a0a0a;border:3px solid #1c1c1c;border-radius:8px;
    box-shadow:0 12px 40px #000c;z-index:99999;overflow:hidden;
    font-family:'VT323',monospace;user-select:none;
}
#vdgs-header{
    background:#151515;padding:6px 10px;font-size:14px;color:#555;
    display:flex;justify-content:space-between;align-items:center;
    cursor:move;border-bottom:1px solid #222;
}
#vdgs-header button{
    background:0;border:0;color:#777;font-size:18px;cursor:pointer;
    font-family:'VT323',monospace;line-height:1;
}
#vdgs-screen{background:#000;padding:14px 10px 16px;text-align:center}
#vdgs-slow{
    font-size:18px;color:#ffcc00;text-shadow:0 0 10px #ffaa00;
    min-height:20px;letter-spacing:2px;margin-bottom:2px;
    opacity:0;transition:opacity .15s;
}
#vdgs-slow.show{opacity:1}
#vdgs-type{
    font-size:30px;color:#ffb000;letter-spacing:1px;
    text-shadow:0 0 10px #ffb000cc;min-height:38px;line-height:1.2;
}
#vdgs-guidance{
    position:relative;height:118px;
    display:flex;justify-content:center;align-items:center;
}
#vdgs-t-wrap{
    display:none;position:absolute;left:50%;top:8px;
    transform:translateX(-50%);flex-direction:column;align-items:center;
}
#vdgs-t-top{width:52px;height:10px;background:#ffb000;box-shadow:0 0 14px #ff8800}
#vdgs-t-stem{
    width:12px;background:#ffb000;box-shadow:0 0 14px #ff8800;
    transition:height .06s linear;margin-top:-1px;
}
#vdgs-pos-arrow{
    color:#ffb000;font-size:20px;text-shadow:0 0 11px #ff8800;
    margin-top:4px;transition:transform .08s linear;
}
#vdgs-float{
    display:none;color:#ffb000;font-size:24px;
    text-shadow:0 0 12px #ff8800;
    animation:float-move 1.1s ease-in-out infinite;
}
.vdgs-side-arrow{
    position:absolute;top:28px;font-size:26px;color:#ff1a00;
    text-shadow:0 0 12px red;opacity:0;transition:opacity .1s;
}
.vdgs-side-arrow.active{opacity:1;animation:safedock-blink .36s infinite}
#vdgs-left{left:8px}
#vdgs-right{right:8px}
#vdgs-stop-sign{
    display:none;width:118px;height:118px;background:#000;color:#ff1a00;
    font-size:26px;border:6px solid #ff1a00;box-sizing:border-box;
    clip-path:polygon(30% 0%,70% 0%,100% 30%,100% 70%,70% 100%,30% 100%,0% 70%,0% 30%);
    align-items:center;justify-content:center;margin:0 auto;
    box-shadow:0 0 20px #ff1a00b3;text-shadow:0 0 8px #ff1a00;line-height:1;
}
#vdgs-msg{
    font-size:22px;letter-spacing:2px;min-height:28px;margin-top:6px;
    text-shadow:0 0 10px currentColor;
}
#vdgs-msg.ok{color:#ffcc00}
#vdgs-msg.info{color:#ffb000}
#vdgs-status{
    font-size:13px;color:#444;margin-top:6px;
}
#vdgs-controls{
    display:flex;gap:3px;padding:5px;background:#0d0d0d;
    border-top:1px solid #1a1a1a;
}
#vdgs-controls button{
    flex:1;background:#1a1a1a;border:1px solid #2a2a2a;color:#999;
    padding:7px 0;font-size:14px;cursor:pointer;border-radius:3px;
    font-family:'VT323',monospace;
}
#vdgs-controls button:hover{background:#252525}
#vdgs-controls button.active{background:#0a3d0a;border-color:#1a7a1a;color:#6f6}
@keyframes safedock-blink{0%,100%{opacity:1}50%{opacity:.1}}
@keyframes float-move{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
#vdgs-panel.inactive #vdgs-screen{opacity:.25}

#vdgs-miniplayer{
    position:fixed;bottom:24px;left:24px;width:220px;height:130px;
    background:#0a0a0a;border:3px solid #ffb000;border-radius:8px;
    box-shadow:0 8px 30px #000a;z-index:99998;display:none;
    font-family:'VT323',monospace;cursor:pointer;overflow:hidden;
    user-select:none;
}
#vdgs-miniplayer .mp-header{
    background:#151515;padding:6px 10px;font-size:14px;color:#ffb000;
    display:flex;justify-content:space-between;align-items:center;
    border-bottom:1px solid #333;
}
#vdgs-miniplayer .mp-body{
    height:calc(100% - 28px);display:flex;flex-direction:column;
    align-items:center;justify-content:center;color:#ffb000;
    text-align:center;padding:8px;
}
#vdgs-miniplayer .mp-body .title{
    font-size:18px;margin-bottom:8px;text-shadow:0 0 8px #ff8800;
}
#vdgs-miniplayer .mp-body .hint{
    font-size:13px;color:#aaa;line-height:1.4;
}
#vdgs-miniplayer:hover{border-color:#ffcc00;box-shadow:0 0 20px #ffb00066}
`;
    document.head.appendChild(s);
}

function createUI(){
    // ★重要：既存の要素を全部消してから再作成（更新時に表示されなくなる問題を解決）
    ['vdgs-panel','vdgs-miniplayer','vdgs-style'].forEach(id=>{
        const el = document.getElementById(id);
        if(el) el.remove();
    });

    injectCSS();

    const p = document.createElement('div');
    p.id = 'vdgs-panel';
    p.className = 'inactive';
    p.innerHTML = `
<div id="vdgs-header">
<span>ADB SAFEGATE · SAFEDOCK</span>
<button id="vdgs-close">−</button>
</div>
<div id="vdgs-screen">
<div id="vdgs-slow"></div>
<div id="vdgs-type">----</div>
<div id="vdgs-guidance">
<div class="vdgs-side-arrow" id="vdgs-left"></div>
<div id="vdgs-float">▲▲▲</div>
<div id="vdgs-t-wrap">
<div id="vdgs-t-top"></div>
<div id="vdgs-t-stem" style="height:72px"></div>
<div id="vdgs-pos-arrow">↑</div>
</div>
<div id="vdgs-stop-sign">STOP</div>
<div class="vdgs-side-arrow" id="vdgs-right"></div>
</div>
<div id="vdgs-msg" class="info"></div>
<div id="vdgs-status">SET STOP / SET GATE</div>
</div>
<div id="vdgs-controls">
<button id="vdgs-set">SET STOP</button>
<button id="vdgs-gate">SET GATE</button>
<button id="vdgs-arm">ARM</button>
<button id="vdgs-clear">CLEAR</button>
</div>`;
    document.body.appendChild(p);

    const mp = document.createElement('div');
    mp.id = 'vdgs-miniplayer';
    mp.innerHTML = `
<div class="mp-header">
<span>WING CAMERA</span>
<span style="font-size:14px;opacity:.6">●</span>
</div>
<div class="mp-body">
<div class="title">WING VIEW</div>
<div class="hint">Click / Enter to toggle<br>A350 / 777-300ER only</div>
</div>`;
    document.body.appendChild(mp);

    mp.onclick = toggleWingCamera;

    makeDraggable(p, document.getElementById('vdgs-header'));
    makeDraggable(mp, mp.querySelector('.mp-header'));

    document.getElementById('vdgs-close').onclick = () => {
        p.style.display = p.style.display === 'none' ? 'block' : 'none';
    };
    document.getElementById('vdgs-set').onclick = setStopHere;
    document.getElementById('vdgs-gate').onclick = setFromGateNumber;
    document.getElementById('vdgs-arm').onclick = toggleArm;
    document.getElementById('vdgs-clear').onclick = clearDock;

    window.addEventListener('keydown', e => {
        if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if(e.shiftKey && (e.key === 'V' || e.key === 'v')){
            e.preventDefault();
            setStopHere();
            return;
        }
        if(!e.shiftKey && !e.ctrlKey && !e.altKey && (e.key === 'q' || e.key === 'Q')){
            e.preventDefault();
            p.style.display = p.style.display === 'none' ? 'block' : 'none';
            return;
        }
        if(!e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'Enter'){
            e.preventDefault();
            toggleWingCamera();
            return;
        }
    });
}

function makeDraggable(el, h){
    let ox, oy, drag = false;
    h.onmousedown = e => {
        drag = true;
        ox = e.clientX - el.offsetLeft;
        oy = e.clientY - el.offsetTop;
        e.preventDefault();
    };
    document.onmousemove = e => {
        if(!drag) return;
        el.style.left = (e.clientX - ox) + 'px';
        el.style.top = (e.clientY - oy) + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    };
    document.onmouseup = () => drag = false;
}

function setStopHere(){
    const ac = getAircraft();
    if(!ac) return alert('機体準備できていません');
    dock = {lat:ac.lat, lon:ac.lon, heading:ac.hdg};
    armed = true;
    stopEnteredAt = null;
    updateArmButton();
    document.getElementById('vdgs-panel').classList.remove('inactive');
    document.getElementById('vdgs-status').textContent = `Stop ${ac.lat.toFixed(5)} ${Math.round(ac.hdg)}°`;
    findWingCamera();
}

function setFromGateNumber(){
    const ac = getAircraft();
    if(!ac) return alert('機体準備できていません');
    if(!Object.keys(gatesDB).length) return alert('Gates未読込');
    const input = prompt('ゲート番号（例:21 / A12 / 209R）');
    if(input === null) return;
    const q = input.trim().toLowerCase();
    if(!q) return alert('未入力');
    let nearest = null, minD = 1e9;
    for(const icao in gatesDB){
        for(const g of gatesDB[icao] || []){
            if(typeof g.lat !== 'number' || !g.name?.toLowerCase().includes(q)) continue;
            const d = geoDistMeters(ac.lat, ac.lon, g.lat, g.lon);
            if(d < minD){ minD = d; nearest = {icao, gate:g}; }
        }
    }
    if(!nearest) return alert(`「${input}」なし`);
    if(minD > 800 && !confirm(`${nearest.gate.name} ${Math.round(minD)}m先。セット？`)) return;
    const g = nearest.gate;
    const off = offsetPoint(g.lat, g.lon, g.heading || 0, GATE_OFFSET);
    dock = {lat:off.lat, lon:off.lon, heading:g.heading || 0};
    armed = true;
    stopEnteredAt = null;
    updateArmButton();
    document.getElementById('vdgs-panel').classList.remove('inactive');
    document.getElementById('vdgs-status').textContent = `${nearest.icao} ${g.name} 30m手前 ${Math.round(g.heading||0)}°`;
    findWingCamera();
}

function toggleArm(){
    if(!dock) return alert('先にSETしてください');
    armed = !armed;
    if(!armed) stopEnteredAt = null;
    updateArmButton();
    document.getElementById('vdgs-panel').classList.toggle('inactive', !armed);
}

function clearDock(){
    dock = null;
    armed = false;
    stopEnteredAt = null;
    updateArmButton();
    document.getElementById('vdgs-panel').classList.add('inactive');
    document.getElementById('vdgs-type').textContent = '----';
    document.getElementById('vdgs-slow').textContent = '';
    document.getElementById('vdgs-slow').classList.remove('show');
    document.getElementById('vdgs-msg').textContent = '';
    document.getElementById('vdgs-msg').className = 'info';
    document.getElementById('vdgs-t-stem').style.height = '72px';
    document.getElementById('vdgs-pos-arrow').style.transform = 'translateX(0)';
    document.getElementById('vdgs-left').classList.remove('active');
    document.getElementById('vdgs-right').classList.remove('active');
    document.getElementById('vdgs-float').style.display = 'none';
    document.getElementById('vdgs-t-wrap').style.display = 'none';
    document.getElementById('vdgs-stop-sign').style.display = 'none';
    document.getElementById('vdgs-status').textContent = 'SET STOP / SET GATE';
    hideMiniPlayer();
    previousCamMode = -1;
}

function updateArmButton(){
    const b = document.getElementById('vdgs-arm');
    if(b){
        b.textContent = armed ? 'ARMED' : 'ARM';
        b.classList.toggle('active', armed);
    }
}

function showMiniPlayer(){
    const mp = document.getElementById('vdgs-miniplayer');
    if(mp && !miniPlayerVisible){
        mp.style.display = 'block';
        miniPlayerVisible = true;
    }
}
function hideMiniPlayer(){
    const mp = document.getElementById('vdgs-miniplayer');
    if(mp && miniPlayerVisible){
        mp.style.display = 'none';
        miniPlayerVisible = false;
    }
}

function updateDisplay(){
    if(!armed || !dock){
        hideMiniPlayer();
        return;
    }
    const ac = getAircraft();
    if(!ac) return;
    const rel = relativeToDock(ac.lat, ac.lon, dock.lat, dock.lon, dock.heading);
    const along = rel.along, cross = rel.cross, now = Date.now();
    let typeInfo = {base:'ACFT', suffix:null};
    try{
        if(geofs.aircraft.instance.aircraftRecord)
            typeInfo = cleanTypeName(geofs.aircraft.instance.aircraftRecord.name);
    }catch(e){}
    if(now - lastAlternateTime > ALTERNATE_MS){
        alternateToggle = !alternateToggle;
        lastAlternateTime = now;
    }
    let displayType = typeInfo.suffix && alternateToggle ? typeInfo.suffix : typeInfo.base;

    const typeEl = document.getElementById('vdgs-type');
    const slowEl = document.getElementById('vdgs-slow');
    const msgEl = document.getElementById('vdgs-msg');
    const stemEl = document.getElementById('vdgs-t-stem');
    const posEl = document.getElementById('vdgs-pos-arrow');
    const leftEl = document.getElementById('vdgs-left');
    const rightEl = document.getElementById('vdgs-right');
    const floatEl = document.getElementById('vdgs-float');
    const tWrap = document.getElementById('vdgs-t-wrap');
    const stopSign = document.getElementById('vdgs-stop-sign');
    const statusEl = document.getElementById('vdgs-status');

    typeEl.textContent = displayType;
    slowEl.textContent = '';
    slowEl.classList.remove('show');

    if(rel.dist <= 50 && along > TOO_FAR - 10){
        if(wingCamMode < 0) findWingCamera();
        if(wingCamMode >= 0) showMiniPlayer();
        else hideMiniPlayer();
    } else {
        hideMiniPlayer();
    }

    if(rel.dist > CAPTURE_DIST || along < TOO_FAR - 25){
        typeEl.textContent = '----';
        floatEl.style.display = 'none';
        tWrap.style.display = 'none';
        stopSign.style.display = 'none';
        leftEl.classList.remove('active');
        rightEl.classList.remove('active');
        stopEnteredAt = null;
        statusEl.textContent = 'Out of range';
        return;
    }

    const needLeft = Math.abs(cross) > LATERAL_OK && cross > 0;
    const needRight = Math.abs(cross) > LATERAL_OK && cross < 0;
    stopSign.style.display = 'none';

    if(along > TRACK_DIST){
        floatEl.style.display = 'block';
        tWrap.style.display = 'none';
        msgEl.textContent = '';
        msgEl.className = 'info';
        leftEl.classList.remove('active');
        rightEl.classList.remove('active');
        stopEnteredAt = null;
    } else {
        floatEl.style.display = 'none';
        if(along <= STOP_DIST){
            tWrap.style.display = 'none';
            leftEl.classList.remove('active');
            rightEl.classList.remove('active');
            if(stopEnteredAt === null) stopEnteredAt = now;
            if(Math.abs(cross) < LATERAL_OK * 1.3 && ac.gs < 2 && (now - stopEnteredAt) >= OK_DELAY_MS){
                stopSign.style.display = 'none';
                msgEl.textContent = 'OK';
                msgEl.className = 'ok';
            } else {
                stopSign.style.display = 'flex';
                msgEl.textContent = '';
                msgEl.className = 'info';
            }
        } else {
            stopEnteredAt = null;
            tWrap.style.display = 'flex';
            leftEl.classList.toggle('active', needLeft);
            rightEl.classList.toggle('active', needRight);

            const offset = Math.max(-34, Math.min(34, (cross / 5.5) * 34));
            posEl.style.transform = `translateX(${offset}px)`;

            let stemH = 72;
            if(along <= CLOSE_DIST)
                stemH = Math.max(1, ((along - STOP_DIST) / (CLOSE_DIST - STOP_DIST)) * 72);
            stemEl.style.height = stemH + 'px';

            if(along < 30){
                typeEl.textContent = along.toFixed(1) + 'm';
                if(ac.gs >= 5){
                    slowEl.textContent = 'SLOW';
                    slowEl.classList.add('show');
                }
            }
            msgEl.textContent = '';
            msgEl.className = 'info';
        }
    }
    statusEl.textContent = `XTE ${cross >= 0 ? 'R' : 'L'}${Math.abs(cross).toFixed(1)} ${ac.gs.toFixed(0)}kt`;
}

function waitForGeoFS(cb){
    const t = setInterval(() => {
        if(window.geofs?.aircraft?.instance?.llaLocation){
            clearInterval(t);
            cb();
        }
    }, 400);
}

waitForGeoFS(() => {
    createUI();
    loadGates();
    setInterval(updateDisplay, UPDATE_MS);
});
})();
