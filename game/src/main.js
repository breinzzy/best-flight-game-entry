// SKYLINE RUNNER v8 — Campaign (Three.js r160). The v7 Sunset Rally, rebuilt
// as a campaign: 3 sorties with different goals, one tank of fuel, airframe
// damage, turnaround refits, feats, and a real 3D cockpit. Gameplay core
// (flight model, rings, PAPI, landing) kept from v7; the campaign rules live
// in campaign.js, the debrief model in debrief.js, the cockpit in cockpit3d.js.
import { initRenderer, renderFrame, rebuildRings } from './render3d.js';
import { SORTIES, REFITS, FEATS, BINGO_KG, FEAT_POINTS, newCampaign, hasRefit, burnMul, thrustMul, windMul, damageMul, stallDelta, ringBonus, flareBonus, fuelBurnRate, refitOffer, applyRefit, awardFeat, featsEarned, featById, campaignTotal } from './campaign.js';
import { landingRows, glidepath, sortieRows, campaignRows } from './debrief.js';

'use strict';
window.addEventListener('error',e=>{const g=document.getElementById('ovgo');if(g)g.textContent='Error: '+(e.message||e.error)+' @'+e.lineno+':'+e.colno;});
// HUD canvas (2D overlay; the WebGL canvas #gl belongs to the renderer).
const hc=document.getElementById('hud'),ctx=hc.getContext('2d');
const SHOW_FPS=new URLSearchParams(location.search).get('fps')==='1';

// ================= math =================
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],scl=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l]};
const lerp=(a,b,t)=>a+(b-a)*t,clamp=(x,a,b)=>x<a?a:x>b?b:x;
const vlerp=(a,b,t)=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const DEG=180/Math.PI;
function rot(v,k,a){const c=Math.cos(a),s=Math.sin(a),kv=cross(k,v),d=dot(k,v)*(1-c);return [v[0]*c+kv[0]*s+k[0]*d,v[1]*c+kv[1]*s+k[1]*d,v[2]*c+kv[2]*s+k[2]*d];}
const basisM=(X,Y,Z,p)=>[X[0],X[1],X[2],0,Y[0],Y[1],Y[2],0,Z[0],Z[1],Z[2],0,p[0],p[1],p[2],1];
const I4=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

// ================= noise / terrain =================
function hs(i,j){let n=(Math.imul(i,374761393)+Math.imul(j,668265263))|0;n=Math.imul(n^(n>>>13),1274126177);n^=n>>>16;return (n>>>0)/4294967296;}
function vn(x,z){const xi=Math.floor(x),zi=Math.floor(z),xf=x-xi,zf=z-zi,u=xf*xf*(3-2*xf),v=zf*zf*(3-2*zf);
 const a=hs(xi,zi),b=hs(xi+1,zi),c=hs(xi,zi+1),d=hs(xi+1,zi+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}
function fbm(x,z,o=6){let s=0,a=.5,t=0;for(let i=0;i<o;i++){s+=vn(x,z)*a;t+=a;x=x*2.03+17.1;z=z*2.03-9.4;a*=.5;}return s/t;}
const RWY={hw:30,hl:600,y:20};
function height(x,z){
 let n=fbm(x/2300+3.3,z/2300+7.7);
 let h=(n-.40)*700;
 const m=fbm(x/1100+50,z/1100+50,5);
 const far=sstep(900,2600,Math.hypot(x-300,z+200));
 h+=Math.pow(Math.max(0,m-.47)*2.2,2)*1300*far;
 h-=sstep(3800,5900,Math.max(Math.abs(x),Math.abs(z)))*650;
 const dx=Math.max(0,Math.abs(x)-RWY.hw),dz=Math.max(0,Math.abs(z)-RWY.hl);
 const k=sstep(140,800,Math.hypot(dx,dz));
 // clear approach corridor south of Runway 36: a flat valley so the final
 // approach is flyable (the hills south of the field rise past 200 m otherwise)
 const cm=(1-sstep(150,450,Math.abs(x)))*sstep(600,700,z)*(1-sstep(1900,2600,z));
 h=lerp(h,22,cm);
 return lerp(RWY.y,h,k);
}
const N=256,SZ=12000,CS=SZ/N,NV=N+1,HG=new Float32Array(NV*NV);
for(let j=0;j<NV;j++)for(let i=0;i<NV;i++)HG[j*NV+i]=height(-SZ/2+i*CS,-SZ/2+j*CS);
function groundAt(x,z){const fx=clamp((x+SZ/2)/CS,0,N-.001),fz=clamp((z+SZ/2)/CS,0,N-.001),i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j;
 const a=HG[j*NV+i],b=HG[j*NV+i+1],c=HG[(j+1)*NV+i],d=HG[(j+1)*NV+i+1];return lerp(lerp(a,b,u),lerp(c,d,u),v);}
function slopeAt(x,z){const e=CS;const nx=groundAt(x-e,z)-groundAt(x+e,z),nz=groundAt(x,z-e)-groundAt(x,z+e);return 1-norm([nx,2*e,nz])[1];}
function tcol(x,z,h,sl){
 const r=hs(Math.floor(x/9),Math.floor(z/9))*.07-.035;let c;
 if(h<3)c=[.80,.74,.55];
 else if(h<260){c=[.36,.54,.22];const f=hs(Math.floor(x/260+1000),Math.floor(z/220+1000));
  if(h<150&&f>.5)c=f>.86?[.82,.68,.30]:f>.72?[.58,.62,.26]:f>.6?[.48,.36,.22]:[.42,.52,.20];}
 else if(h<520)c=vlerp([.30,.44,.19],[.22,.33,.16],sstep(260,520,h));
 else c=[.50,.44,.40];
 if(sl>.42&&h>3)c=vlerp(c,[.46,.41,.37],sstep(.42,.62,sl));
 if(h>720)c=vlerp(c,[.95,.96,1],sstep(720,840,h));
 // beach foam: pale stripes right at the waterline
 if(h>=0&&h<7){const fb=vn(x/28+4,z/28+9);c=vlerp(c,[.96,.93,.84],sstep(.45,.75,fb)*sstep(7,1,h));}
 return c.map(v=>clamp(v+r,0,1));
}

// ---------- gates (rebuilt per sortie — each sortie flies a different set) ----------
const GP=SORTIES[0].gp; // the Sunset Rally gates (v7's set, verbatim)
const gates=[];
function buildGates(s){
  const built=s.gp.map((p,i)=>{const g=Math.max(groundAt(p[0],p[1]),0);
    const y=i===s.gp.length-1?Math.max(g+120,120):(s.low?Math.max(g+90,120):Math.max(g+220,180));
    return {p:[p[0],y,p[1]]};});
  built.forEach((g,i)=>{const prev=i?built[i-1].p:[0,0,560],next=i<built.length-1?built[i+1].p:[0,0,0];
    let d=i===built.length-1?[0,0,-1]:sub(next,prev);d=norm([d[0],0,d[2]]);g.d=d;const Y=[0,1,0];g.M=basisM(cross(Y,d),Y,d,g.p);});
  gates.length=0;for(const g of built)gates.push(g);
}
buildGates(SORTIES[0]);

// ---------- minimap ----------
const mini=document.createElement('canvas');mini.width=mini.height=200;
(()=>{const c=mini.getContext('2d'),im=c.createImageData(200,200);for(let y=0;y<200;y++)for(let x=0;x<200;x++){
 const wx=-SZ/2+x/200*SZ,wz=-SZ/2+y/200*SZ,h=groundAt(wx,wz);let col=h<0?[.08,.25,.4]:tcol(wx,wz,h,slopeAt(wx,wz));
 const sh=h<0?1:clamp(1+(groundAt(wx-40,wz-40)-h)*.012,.6,1.3);const k=(y*200+x)*4;
 im.data[k]=col[0]*255*sh;im.data[k+1]=col[1]*255*sh;im.data[k+2]=col[2]*255*sh;im.data[k+3]=235;}c.putImageData(im,0,0);})();

// ================= audio =================
let AC=null,eng,eng2,engG,windG,muted=false;
function initAudio(){if(AC)return;try{AC=new (window.AudioContext||window.webkitAudioContext)();}catch(e){return;}
 eng=AC.createOscillator();eng.type='sawtooth';eng2=AC.createOscillator();eng2.type='triangle';
 const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=520;engG=AC.createGain();engG.gain.value=0;
 eng.connect(lp);eng2.connect(lp);lp.connect(engG).connect(AC.destination);eng.start();eng2.start();
 const b=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
 const ns=AC.createBufferSource();ns.buffer=b;ns.loop=true;const bp=AC.createBiquadFilter();bp.type='bandpass';bp.frequency.value=900;bp.Q.value=.6;
 windG=AC.createGain();windG.gain.value=0;ns.connect(bp).connect(windG).connect(AC.destination);ns.start();}
function tone(f,t0,dur,vol,type='sine'){if(!AC||muted)return;const o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.value=f;
 g.gain.setValueAtTime(0,AC.currentTime+t0);g.gain.linearRampToValueAtTime(vol,AC.currentTime+t0+.01);g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+t0+dur);
 o.connect(g).connect(AC.destination);o.start(AC.currentTime+t0);o.stop(AC.currentTime+t0+dur+.05);}
const chime=()=>{tone(784,0,.35,.18);tone(1046,.08,.35,.15);tone(1568,.16,.6,.12);};
const fanfare=()=>{[523,659,784,1046,1318].forEach((f,i)=>tone(f,i*.12,.7,.14,'triangle'));};
function boom(){if(!AC||muted)return;const b=AC.createBuffer(1,AC.sampleRate*1.6,AC.sampleRate),d=b.getChannelData(0);
 for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2.5);const s=AC.createBufferSource();s.buffer=b;
 const lp=AC.createBiquadFilter();lp.type='lowpass';lp.frequency.value=700;const g=AC.createGain();g.gain.value=.7;s.connect(lp).connect(g).connect(AC.destination);s.start();}
let warnT=0;

// ================= game state =================
let TIME_LIMIT=180; // per-sortie par, set by startSortie
const P={},keys={},mouse={down:false,x:0,y:0};
let state='dispatch',camMode=0,gateIx=0,tRun=0,msg='',msgT=0,fx=[],shake=0,best=(()=>{try{return +(localStorage.getItem('sr_best_campaign')||0)}catch(e){return 0}})(),result='',propA=0,vsS=0,touchVs=0;
let score=0,combo=0,ringsScore=0,gearDown=true,popups=[],trace=[],traceT=0,landBd=null,smoke=[],smokeT=0,touchX=0,sortieSpeed=0;
const C=newCampaign(); // campaign: fuel, airframe, refits, feats (campaign.js)
let refitChoices=[],bingoOpen=false,bingoSaid=false;
function reset(){Object.assign(P,{pos:[0,RWY.y+2.2,560],F:[0,0,-1],U:[0,1,0],R:[1,0,0],v:0,thr:0,grounded:true,vs:0});
 gateIx=0;tRun=0;fx=[];result='';RG.camPos=[0,RWY.y+12,600];score=0;combo=0;ringsScore=0;gearDown=true;popups=[];trace=[];traceT=0;landBd=null;smoke=[];touchVs=0;touchX=0;sortieSpeed=0;
 bingoOpen=false;bingoSaid=false;C.straightIn=false;C.incidents=0;C.maxCombo=0;
 say('Throttle up (Shift / R), rotate at 75 kt with S',5);}

// ---------- campaign flow ----------
function startSortie(si){
  C.sortie=si;const s=SORTIES[si];
  buildGates(s);TIME_LIMIT=s.par;rebuildRings(RG);
  C.bingoAnswered=false;C.bingoPressedOn=false;C.straightIn=false;C.incidents=0;C.maxCombo=0;
  say(`SORTIE ${si+1}/3 — ${s.name}: ${s.brief}`,5);
}
function flySortie(si){startSortie(si);reset();state='fly';ov.classList.add('hide');}
function advanceAfterDebrief(){
  const si=C.sortie;
  if(C.failed){newCampaignStart();return;}
  if(si>=SORTIES.length-1){showCampaignDone();return;}
  refitChoices=refitOffer(C);showRefit();
}
function newCampaignStart(){Object.assign(C,newCampaign());showDispatch();}
function say(t,d=3){msg=t;msgT=d;}
function ortho(){P.F=norm(P.F);P.R=norm(cross(P.F,P.U));P.U=norm(cross(P.R,P.F));}
function rotAll(k,a,which){for(const w of which)P[w]=rot(P[w],k,a);}
function crash(why){if(state!=='fly')return;state='crashed';boom();shake=1.2;fx.push({p:P.pos.slice(),t:0});
 setTimeout(()=>showOv('CRASHED',(why||'The Skyline Runner is scrap metal.')+' Press ENTER to try again.'),1400);}
const onRunway=(x,z)=>Math.abs(x)<RWY.hw+2&&Math.abs(z)<RWY.hl+20;

function update(dt){
 if(state!=='fly'&&state!=='crashed'&&state!=='done')return;
 fx.forEach(f=>f.t+=dt);shake=Math.max(0,shake-dt);msgT-=dt;
 if(state!=='fly')return;
 tRun+=dt;
 // fuel: one tank shared across the whole campaign (campaign.js).
 if(C.fuelKg>0)C.fuelKg=Math.max(0,C.fuelKg-fuelBurnRate(C,P.thr)*dt);
 if(C.fuelKg<=BINGO_KG&&!C.bingoAnswered&&gateIx<gates.length){
   if(!bingoOpen){bingoOpen=true;say('BINGO FUEL — 1 STRAIGHT IN · 2 PRESS ON',99);}
 }else if(bingoOpen&&C.fuelKg>BINGO_KG)bingoOpen=false;
 if(C.fuelKg<=0&&P.thr>0){P.thr=0;if(!bingoSaid){bingoSaid=true;say('FUEL STARVATION — GLIDE HER IN',4);}}
 if(tRun>=TIME_LIMIT&&tRun-dt<TIME_LIMIT)say('PAR TIME PASSED — time bonus lost',3);
 // score popups + smoke trails decay
 popups.forEach(p=>p.t+=dt);popups=popups.filter(p=>p.t<1.4);
 smokeT-=dt;if(!P.grounded&&Math.abs(P.R[1])>.22&&smokeT<=0){smokeT=.06;for(const s of[-1,1])smoke.push({p:add(P.pos,scl(P.R,s*5.6)),t:0});if(smoke.length>140)smoke.splice(0,smoke.length-140);}
 smoke.forEach(s=>s.t+=dt);smoke=smoke.filter(s=>s.t<2.2);
 let pit=(keys.KeyS||keys.ArrowDown?1:0)-(keys.KeyW||keys.ArrowUp?1:0);
 let rol=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0);
 const yaw=(keys.KeyE?1:0)-(keys.KeyQ?1:0);
 RG.input.pit=pit;RG.input.rol=rol;RG.input.yaw=yaw;
 if(mouse.down){const cx=innerWidth/2,cy=innerHeight/2;rol=clamp((mouse.x-cx)/(innerWidth*.25),-1,1);pit=clamp((mouse.y-cy)/(innerHeight*.25),-1,1);}
 if(keys.ShiftLeft||keys.ShiftRight||keys.KeyR)P.thr+=dt*.9;
 if(keys.KeyZ||keys.KeyF)P.thr-=dt*.9;P.thr=clamp(P.thr,0,1);
 const auth=clamp((P.v-15)/45,0,1.15);
 if(P.grounded){rol=0;if(P.v<31&&pit>0)pit=0;}
 rotAll(P.R,pit*1.25*auth*dt,['F','U']);
 rotAll(P.F,rol*2.3*auth*dt,['R','U']);
 const ya=P.grounded?-(yaw||(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0))*.7*clamp(P.v/8,0,1)*dt:-yaw*.45*auth*dt;
 rotAll(P.grounded?[0,1,0]:P.U,ya,['F','R','U']);
 if(!P.grounded){rotAll([0,1,0],P.R[1]*.85*auth*dt,['F','R','U']);
  if(!rol&&!mouse.down){const r=Math.atan2(-P.R[1],P.U[1]);if(Math.abs(r)<1.3)rotAll(P.F,-r*.45*dt,['R','U']);}}
 ortho();
 const brake=keys.Space&&P.grounded;
 const acc=P.thr*30*thrustMul(C)-.0019*P.v*P.v-9.8*P.F[1]*.9-(P.grounded?(brake?14:1.2):0)-(gearDown&&!P.grounded?1.8:0);
 P.v=Math.max(0,P.v+acc*dt);
 const STALL_V=38+stallDelta(C); // gyro-stabiliser refit lowers it by 5
 let sink=0;if(!P.grounded&&P.v<STALL_V){sink=(STALL_V-P.v)/STALL_V*28;rotAll(P.R,-dt*(STALL_V-P.v)/STALL_V*.9,['F','U']);ortho();}
 // crosswind + storm gusts push the airframe sideways (grounded = no drift)
 const w=SORTIES[C.sortie].wind,wm=windMul(C);
 const gust=SORTIES[C.sortie].weather==='storm'?Math.sin(tRun*.7)*1.5*wm:0;
 const vel=add(add(scl(P.F,P.v),[0,-sink,0]),P.grounded?[0,0,0]:[w[0]*wm+gust,0,w[1]*wm]);
 const py=P.pos[1];P.pos=add(P.pos,scl(vel,dt));P.vs=(P.pos[1]-py)/dt;vsS=lerp(vsS,P.vs,1-Math.exp(-dt*4));
 const g=Math.max(groundAt(P.pos[0],P.pos[2]),0),agl=P.pos[1]-g;
 if(agl<2.25){const rw=onRunway(P.pos[0],P.pos[2]),lvl=Math.abs(P.R[1])<.3&&P.F[1]>-.2,water=groundAt(P.pos[0],P.pos[2])<0;
  if(!water&&lvl&&(rw?P.vs>-7.5:(P.vs>-3.5&&P.v<30))){
   if(!gearDown){crash('Belly landing — the gear was up.');}
   else{
   if(!P.grounded){touchVs=P.vs;touchX=P.pos[0];if(P.v>20)say(touchVs>-1.5?'Butter landing!':touchVs>-3.5?'Firm touchdown':'Hard landing!',3);}
   P.grounded=true;P.pos[1]=g+2.2;if(P.F[1]<0)P.F[1]=0;P.U=[0,1,0];ortho();
   if(!rw&&P.v>25)crash('Off-runway landing at speed.');}
  }else crash();}
 else if(agl>2.6)P.grounded=false;
 if(Math.max(Math.abs(P.pos[0]),Math.abs(P.pos[2]))>5600&&msgT<.5)say('Leaving the island — turn back!',1.5);
 if(Math.max(Math.abs(P.pos[0]),Math.abs(P.pos[2]))>7500)crash('You left the island airspace.');
 if(gateIx<gates.length){const gt=gates[gateIx];if(len(sub(P.pos,gt.p))<29){gateIx++;combo++;C.maxCombo=Math.max(C.maxCombo,combo);
   let pts=250+ringBonus(C)+(combo-1)*50,extra='';
   const s=SORTIES[C.sortie];
   if(s.speedBonus&&P.v>50){pts+=100;extra=' SPEED +100';sortieSpeed+=100;}
   if(combo>=5&&awardFeat(C,'on-rails'))say('★ FEAT — ON RAILS',2);
   if(combo>=8&&awardFeat(C,'eight-in-a-row'))say('★ FEAT — EIGHT IN A ROW',2);
   ringsScore+=pts;score+=pts;popups.push({p:gt.p.slice(),text:'+'+pts,t:0});chime();
   say(gateIx<gates.length?`Ring ${gateIx} / ${gates.length}  +${pts}${combo>1?'  COMBO x'+combo:''}${extra}`:'All rings cleared — land on Runway 36!',3);}}
 else if(P.grounded&&P.v<3&&onRunway(P.pos[0],P.pos[2])){state='done';fanfare();
  const lr=landingRows(touchVs,touchX,Math.max(0,Math.round(TIME_LIMIT-tRun))*5);
  const flare=flareBonus(C),si=C.sortie,s=SORTIES[si];
  let dmg=0;
  if(touchVs<-5){dmg=Math.round(15*damageMul(C));C.airframe=Math.max(0,C.airframe-dmg);C.incidents++;}
  if(touchVs>-1.02&&awardFeat(C,'greaser'))say('★ FEAT — GREASER',2);
  if(si===0)awardFeat(C,'first-light');
  if(si===2)awardFeat(C,'storm-rider');
  if(C.incidents===0)awardFeat(C,'clean-sheet');
  if(C.bingoPressedOn)awardFeat(C,'press-on');
  const total=ringsScore+lr.sink+lr.centre+lr.time+sortieSpeed+flare;
  landBd={rings:ringsScore,ringsHit:gateIx,ringsTotal:gates.length,sink:lr.sink,centre:lr.centre,time:lr.time,
    speed:sortieSpeed,flare,touchVs,centreX:touchX,total,sortie:si,dmg,glide:glidepath(trace)};
  score=total;C.scores[si]=total;C.status[si]='FLOWN';
  if(si<SORTIES.length-1)C.status[si+1]='NEXT';
  if(si===SORTIES.length-1)awardFeat(C,'all-home');
  if(C.airframe<=0){C.failed=true;say('AIRFRAME GROUNDED — the campaign is over',4);}
 }
 // final-approach trace for the glidepath graph (distance to the Runway 36 threshold, height above it)
 if(gateIx>=gates.length&&!P.grounded&&state==='fly'){traceT-=dt;if(traceT<=0){traceT=.25;const d=Math.hypot(P.pos[0],P.pos[2]-RWY.hl);trace.push({d,h:Math.max(0,P.pos[1]-RWY.y)});if(trace.length>120)trace.shift();}}
 if(P.thr>.0)propA+=dt*(20+P.thr*60);else propA+=dt*P.v*.3;
 if(!P.grounded&&P.v<42){warnT-=dt;if(warnT<0){tone(1200,0,.12,.08,'square');warnT=.4;}}
}
const fmtT=t=>{const m=Math.floor(t/60),s=t-m*60;return `${m}:${s<10?'0':''}${s.toFixed(1)}`;};


// ============ renderer context (shared with render3d.js) ============
// Live objects (P, keys, gates, smoke/fx arrays) are shared by reference;
// primitives are copied into G by syncG() before every rendered frame.
const RG={P,keys,gates,GP,HG,N,SZ,CS,RWY,groundAt,height,tcol,mini,hs,vn,fbm,slopeAt,
 state:'dispatch',gateIx:0,camMode:0,shake:0,propA:0,gearDown:true,
 smoke:[],fx:[],popups:[],trace:[],camPos:[0,40,620],tRun:0,score:0,combo:0,
 weather:'clear',wind:[0,0],fuelKg:420,tankKg:420,vsS:0,sortieIx:0,
 input:{pit:0,rol:0,yaw:0},VP:I4.slice(),perf:{fps:0,calls:0,tris:0}};
function syncG(){RG.state=state;RG.gateIx=gateIx;RG.camMode=camMode;RG.shake=shake;RG.propA=propA;
 RG.gearDown=gearDown;RG.smoke=smoke;RG.fx=fx;RG.popups=popups;RG.trace=trace;
 RG.tRun=tRun;RG.score=score;RG.combo=combo;
 RG.weather=SORTIES[C.sortie].weather;RG.wind=SORTIES[C.sortie].wind;
 RG.fuelKg=C.fuelKg;RG.tankKg=C.tankKg;RG.vsS=vsS;RG.sortieIx=C.sortie;}


let dpr=1;
function resize(){dpr=Math.min(devicePixelRatio||1,2);for(const c of[hc]){c.width=innerWidth*dpr;c.height=innerHeight*dpr;}}
addEventListener('resize',resize);resize();

function proj(p){const x=p[0],y=p[1],z=p[2],M=RG.VP;const cx=M[0]*x+M[4]*y+M[8]*z+M[12],cy=M[1]*x+M[5]*y+M[9]*z+M[13],cw=M[3]*x+M[7]*y+M[11]*z+M[15];
 return {x:(cx/cw*.5+.5)*hc.width,y:(1-(cy/cw*.5+.5))*hc.height,w:cw};}

// ================= HUD =================
const G='#7CFFB2',AMB='#ffc25a';
function txt(t,x,y,size,col=G,align='left',bold=false){ctx.font=`${bold?'700 ':''}${size*dpr}px Consolas,"Courier New",monospace`;ctx.fillStyle=col;ctx.textAlign=align;ctx.fillText(t,x,y);}
function tape(x,y,h,val,pxPer,major,minor,right,label){const s=dpr,w=58*s;ctx.save();ctx.beginPath();ctx.rect(x-w/2,y-h/2,w,h);ctx.clip();
 ctx.textBaseline='middle';
 const range=h/2/pxPer;for(let v=Math.floor((val-range)/minor)*minor;v<=val+range;v+=minor){const yy=y-(v-val)*pxPer,isM=Math.abs(v%major)<1e-6,tl=(isM?14:7)*s,ex=right?x-w/2:x+w/2;
  ctx.beginPath();ctx.moveTo(ex,yy);ctx.lineTo(ex+(right?tl:-tl),yy);ctx.stroke();if(isM&&v>=0)txt(String(v),right?ex+tl+4*s:ex-tl-4*s,yy,12,G,right?'left':'right');}
 ctx.restore();ctx.textBaseline='middle';ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(x-w/2-8*s,y-15*s,w+16*s,30*s);ctx.strokeRect(x-w/2-8*s,y-15*s,w+16*s,30*s);
 txt(String(Math.round(val)),x,y,18,G,'center',true);txt(label,x,y-h/2-12*s,12,G,'center');}
function dial(x,y,r,frac,label,val,sub){const s=dpr;ctx.save();ctx.shadowBlur=0;
 const gr=ctx.createRadialGradient(x,y-r*.3,r*.1,x,y,r);gr.addColorStop(0,'#1c2530');gr.addColorStop(1,'#070a0e');ctx.fillStyle=gr;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();
 ctx.lineWidth=3*s;ctx.strokeStyle='#4b5866';ctx.stroke();ctx.lineWidth=1.5*s;ctx.strokeStyle=AMB;ctx.shadowColor=AMB;ctx.shadowBlur=6*s;
 for(let i=0;i<=20;i++){const a=(135+i/20*270)/DEG,l=i%2?.1:.2;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*r*.88,y+Math.sin(a)*r*.88);ctx.lineTo(x+Math.cos(a)*r*(.88-l),y+Math.sin(a)*r*(.88-l));ctx.stroke();}
 const a=(135+clamp(frac,0,1)*270)/DEG;ctx.lineWidth=3*s;ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.cos(a)*r*.75,y+Math.sin(a)*r*.75);ctx.stroke();
 ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,4*s,0,7);ctx.fill();
 ctx.textBaseline='middle';txt(label,x,y-r*.35,10,AMB,'center');txt(val,x,y+r*.42,13,'#fff','center',true);if(sub)txt(sub,x,y+r*.66,9,AMB,'center');ctx.restore();}
function attitude(x,y,r,pitch,roll){const s=dpr;ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.clip();ctx.translate(x,y);ctx.rotate(-roll);
 const off=pitch*DEG*r/35;ctx.fillStyle='#2f78c8';ctx.fillRect(-r*2,-r*2+off,r*4,r*2);ctx.fillStyle='#7a5230';ctx.fillRect(-r*2,off,r*4,r*2);
 ctx.strokeStyle='#fff';ctx.lineWidth=2*s;ctx.beginPath();ctx.moveTo(-r*2,off);ctx.lineTo(r*2,off);ctx.stroke();ctx.lineWidth=1*s;
 for(const p of[-20,-10,10,20]){const yy=off-p*r/35,w=p%20?r*.25:r*.4;ctx.beginPath();ctx.moveTo(-w,yy);ctx.lineTo(w,yy);ctx.stroke();}
 ctx.restore();ctx.save();ctx.strokeStyle=AMB;ctx.lineWidth=3*s;ctx.shadowColor=AMB;ctx.shadowBlur=6*s;ctx.beginPath();ctx.moveTo(x-r*.55,y);ctx.lineTo(x-r*.18,y);ctx.lineTo(x-r*.1,y+r*.1);
 ctx.moveTo(x+r*.55,y);ctx.lineTo(x+r*.18,y);ctx.lineTo(x+r*.1,y+r*.1);ctx.stroke();ctx.fillStyle=AMB;ctx.beginPath();ctx.arc(x,y,3*s,0,7);ctx.fill();
 ctx.shadowBlur=0;ctx.lineWidth=3*s;ctx.strokeStyle='#4b5866';ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.stroke();txt('ATTITUDE',x,y+r+12*s,9,AMB,'center');ctx.restore();}
function compass(x,y,r,hdg){const s=dpr;ctx.save();ctx.fillStyle='#070a0e';ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();ctx.translate(x,y);ctx.rotate(-hdg/DEG);
 ctx.strokeStyle=AMB;ctx.shadowColor=AMB;ctx.shadowBlur=5*s;ctx.lineWidth=1.5*s;ctx.textBaseline='middle';
 for(let i=0;i<36;i++){const a=i*10/DEG-Math.PI/2;const l=i%3?.1:.18;ctx.beginPath();ctx.moveTo(Math.cos(a)*r*.9,Math.sin(a)*r*.9);ctx.lineTo(Math.cos(a)*r*(.9-l),Math.sin(a)*r*(.9-l));ctx.stroke();}
 ['N','E','S','W'].forEach((c,i)=>{const a=i*Math.PI/2-Math.PI/2;txt(c,Math.cos(a)*r*.58,Math.sin(a)*r*.58,12,i?AMB:'#ff6b5a','center',true);});ctx.restore();
 ctx.save();ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(x,y-r*.35);ctx.lineTo(x-r*.12,y+r*.2);ctx.lineTo(x,y+r*.1);ctx.lineTo(x+r*.12,y+r*.2);ctx.fill();
 ctx.lineWidth=3*s;ctx.strokeStyle='#4b5866';ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.stroke();txt('HDG '+String(Math.round(hdg)%360).padStart(3,'0'),x,y+r+12*s,9,AMB,'center');ctx.restore();}
function hud(t){const W=hc.width,H=hc.height,s=dpr;ctx.clearRect(0,0,W,H);if(state==='title')return;
 const pitch=Math.asin(clamp(P.F[1],-1,1)),roll=Math.atan2(-P.R[1],P.U[1]),hdg=(Math.atan2(P.F[0],-P.F[2])*DEG+360)%360;
 const kt=P.v*1.944,ft=P.pos[1]*3.281,g=Math.max(groundAt(P.pos[0],P.pos[2]),0),aglFt=(P.pos[1]-2.2-g)*3.281;
 // (3D cockpit: the panel is geometry now — cockpit3d.js. No 2D frame.)
 ctx.save();ctx.lineWidth=2*s;ctx.strokeStyle=G;ctx.fillStyle=G;ctx.shadowColor='rgba(124,255,178,.9)';ctx.shadowBlur=6*s;
 const bp=proj(add(P.pos,scl(P.F,3000)));const bx=bp.w>0?bp.x:W/2,by=bp.w>0?bp.y:H*.4,ppd=H/62;
 ctx.save();ctx.beginPath();ctx.rect(bx-200*s,by-170*s,400*s,340*s);ctx.clip();ctx.translate(bx,by);ctx.rotate(-roll);ctx.textBaseline='middle';
 for(let p=-40;p<=40;p+=5){const yy=(pitch*DEG-p)*ppd;if(Math.abs(yy)>400*s)continue;const w=(p===0?260:p%10?40:90)*s;
  ctx.setLineDash(p<0?[8*s,6*s]:[]);ctx.beginPath();ctx.moveTo(-w,yy);ctx.lineTo(-24*s,yy);ctx.moveTo(24*s,yy);ctx.lineTo(w,yy);ctx.stroke();
  if(p&&p%10===0){txt(String(p),-w-6*s,yy,12,G,'right');txt(String(p),w+6*s,yy,12,G,'left');}}
 ctx.setLineDash([]);ctx.restore();
 ctx.beginPath();ctx.moveTo(bx-30*s,by);ctx.lineTo(bx-12*s,by);ctx.lineTo(bx-6*s,by+8*s);ctx.lineTo(bx,by);ctx.lineTo(bx+6*s,by+8*s);ctx.lineTo(bx+12*s,by);ctx.lineTo(bx+30*s,by);ctx.stroke();
 const cy=H*.42,th=Math.min(250*s,H*.36);
 tape(W/2-Math.min(330*s,W*.3),cy,th,kt,3*s,20,10,false,'IAS KT');
 tape(W/2+Math.min(330*s,W*.3),cy,th,ft,.3*s,200,100,true,'ALT FT');
 txt(`VS ${vsS*196.9>0?'+':''}${Math.round(vsS*196.9/10)*10}`,W/2+Math.min(330*s,W*.3),cy+th/2+18*s,12,G,'center');
 if(aglFt<1500)txt(`RA ${Math.max(0,Math.round(aglFt))}`,W/2+Math.min(330*s,W*.3),cy+th/2+34*s,12,AMB,'center');
 txt(`THR ${Math.round(P.thr*100)}%`,W/2-Math.min(330*s,W*.3),cy+th/2+18*s,12,G,'center');
 txt(`G/S ${Math.round(kt)}`,W/2-Math.min(330*s,W*.3),cy+th/2+34*s,12,G,'center');
 // heading tape
 const hy=34*s,hw=440*s;ctx.save();ctx.beginPath();ctx.rect(W/2-hw/2,hy-18*s,hw,40*s);ctx.clip();ctx.textBaseline='middle';
 for(let d=Math.floor(hdg-30);d<=hdg+30;d++){if(d%5)continue;const xx=W/2+(d-hdg)*7*s;ctx.beginPath();ctx.moveTo(xx,hy+20*s);ctx.lineTo(xx,hy+(d%10?14:8)*s);ctx.stroke();
  if(d%10===0){const dd=(d+360)%360;txt(({0:'N',90:'E',180:'S',270:'W'})[dd]||String(dd/10).padStart(2,'0'),xx,hy-4*s,13,G,'center',dd%90===0);}}
 ctx.restore();ctx.textBaseline='middle';ctx.fillStyle='rgba(0,0,0,.75)';ctx.fillRect(W/2-26*s,hy+22*s,52*s,22*s);ctx.strokeRect(W/2-26*s,hy+22*s,52*s,22*s);
 txt(String(Math.round(hdg)%360).padStart(3,'0')+'°',W/2,hy+33*s,15,G,'center',true);
 // target marker
 const done=gateIx>=gates.length,tp=done?[0,RWY.y,RWY.hl-80]:gates[gateIx].p,dist=len(sub(tp,P.pos)),pr=proj(tp);
 const label=done?`RWY 36  ${(dist/1000).toFixed(1)} km`:`RING ${gateIx+1}  ${(dist/1000).toFixed(1)} km`;
 const on=pr.w>0&&pr.x>40*s&&pr.x<W-40*s&&pr.y>60*s&&pr.y<H-60*s;ctx.strokeStyle=AMB;ctx.shadowColor=AMB;
 if(on){const r=(12+Math.sin(t*.008)*3)*s;ctx.beginPath();ctx.moveTo(pr.x,pr.y-r);ctx.lineTo(pr.x+r,pr.y);ctx.lineTo(pr.x,pr.y+r);ctx.lineTo(pr.x-r,pr.y);ctx.closePath();ctx.stroke();txt(label,pr.x,pr.y+r+14*s,12,AMB,'center',true);}
 else{let dx=pr.x-W/2,dy=pr.y-H/2;if(pr.w<0){dx=-dx;dy=-dy;}const a=Math.atan2(dy,dx),ex=W/2+Math.cos(a)*W*.36,ey=H*.45+Math.sin(a)*H*.32;
  ctx.save();ctx.translate(ex,ey);ctx.rotate(a);ctx.fillStyle=AMB;ctx.beginPath();ctx.moveTo(18*s,0);ctx.lineTo(-8*s,-11*s);ctx.lineTo(-3*s,0);ctx.lineTo(-8*s,11*s);ctx.fill();ctx.restore();txt(label,ex,ey+24*s,12,AMB,'center',true);}
 // floating score popups (world-anchored, rise and fade)
 popups.forEach(p=>{const pr2=proj(p.p);if(pr2.w>0){ctx.globalAlpha=clamp(1.4-p.t,0,1);txt(p.text,pr2.x,pr2.y-p.t*40*s,26,'#ffd27a','center',true);ctx.globalAlpha=1;}});
 // info panel
 const PW=(()=>{ctx.font=`${12*dpr}px Consolas,"Courier New",monospace`;const w=ctx.measureText('SORTIE 3/3 · STORM APPROACH — FUEL 420 KG · AIRFRAME 100%').width;return Math.max(262*s,w+28*s);})();
 ctx.shadowBlur=0;ctx.fillStyle='rgba(5,14,24,.38)';ctx.fillRect(16*s,16*s,PW,150*s);ctx.strokeStyle='rgba(124,255,178,.35)';ctx.strokeRect(16*s,16*s,PW,150*s);
 const tLeft=Math.max(0,TIME_LIMIT-tRun);
 const srt=SORTIES[C.sortie];
 ctx.textBaseline='alphabetic';txt('SKYLINE RUNNER',28*s,36*s,12,AMB,'left',true);
 txt(`SCORE  ${score.toLocaleString('en-US')}${combo>1?'   COMBO x'+combo:''}`,28*s,58*s,16,G,'left',true);
 txt(`RINGS  ${gateIx} / ${gates.length}   TIME  ${tLeft>0?fmtT(tLeft):'+'+fmtT(tRun-TIME_LIMIT)}`,28*s,78*s,13,tLeft>0?(tLeft<30?'#ff6b5a':G):'#ff6b5a');
 txt(`SORTIE ${C.sortie+1}/3 · ${srt.name}   ·   FUEL ${Math.round(C.fuelKg)} KG   ·   AIRFRAME ${Math.round(C.airframe)}%`,28*s,98*s,12,C.fuelKg<BINGO_KG?'#ff6b5a':'#e8f4ff');
 ctx.fillStyle='rgba(255,255,255,.15)';ctx.fillRect(28*s,106*s,PW-56*s,7*s);
 ctx.fillStyle=C.fuelKg<BINGO_KG?'#ff4b3a':'#ffc25a';ctx.fillRect(28*s,106*s,(PW-56*s)*Math.max(0,C.fuelKg/C.tankKg),7*s);
 txt(`GEAR ${gearDown?'DN':'UP'}   ·   ${done?'► Land on Runway 36 and stop':P.grounded&&gateIx===0?'► Take off from Runway 36':`► Fly through ring ${gateIx+1}`}${srt.weather==='storm'?'   ·   WIND 270° 14 KT':''}`,28*s,132*s,12,'#e8f4ff');
 if(best)txt('BEST CAMPAIGN '+best.toLocaleString('en-US'),28*s,150*s,11,G);
 txt(`${camMode?'COCKPIT':'CHASE'} VIEW · C`,W-18*s,30*s,12,G,'right');txt(muted?'SOUND OFF · M':'SOUND ON · M',W-18*s,48*s,12,G,'right');
 const wy=H*.25;
 if(state==='fly'&&!P.grounded&&P.v<42&&Math.floor(t/250)%2)txt('STALL',W/2,wy,30,'#ff4b3a','center',true);
 else if(state==='fly'&&!P.grounded&&aglFt<250&&vsS<-6&&Math.floor(t/250)%2)txt('PULL UP',W/2,wy,30,'#ff4b3a','center',true);
 if(bingoOpen)txt('BINGO FUEL — 1 STRAIGHT IN · 2 PRESS ON',W/2,H*.32,24,'#ff6b5a','center',true);
 if(state==='fly'&&!window.__shotMode&&P.grounded&&gateIx===0&&P.v<30){txt(P.thr<.9?'HOLD SHIFT / R — FULL THROTTLE':'AT 75 KT, HOLD S TO ROTATE',W/2,H*.3,22,AMB,'center',true);}
 if(msgT>0){ctx.globalAlpha=clamp(msgT,0,1);txt(msg,W/2,H*.2,20,'#fff','center',true);ctx.globalAlpha=1;}
 ctx.restore();
 // instrument panel (chase view only — the 3D cockpit carries its own dials)
 if(camMode!==1){
 const r=Math.min(46*s,W*.035),gap=r*2.35,n=6,px=W/2-gap*(n-1)/2,py=H-r-24*s;
 ctx.save();ctx.fillStyle='rgba(14,18,24,.62)';const pw=gap*n+10*s;ctx.beginPath();ctx.roundRect?ctx.roundRect(W/2-pw/2,py-r-14*s,pw,r*2+34*s,14*s):ctx.rect(W/2-pw/2,py-r-14*s,pw,r*2+34*s);ctx.fill();ctx.strokeStyle='#3a4450';ctx.lineWidth=2*s;ctx.stroke();ctx.restore();
 dial(px,py,r,kt/260,'AIRSPEED',`${Math.round(kt)} KT`);
 attitude(px+gap,py,r,pitch,roll);
 dial(px+gap*2,py,r,(ft%1000)/1000*270/270,'ALTITUDE',`${Math.round(ft)} FT`,`×1000: ${Math.floor(ft/1000)}`);
 compass(px+gap*3,py,r,hdg);
 dial(px+gap*4,py,r,clamp(.5+vsS*196.9/4000,0,1),'VERT SPD',`${Math.round(vsS*196.9/10)*10}`,'FPM');
 dial(px+gap*5,py,r,P.thr,'ENGINE',`${Math.round(800+P.thr*1900)} RPM`,`THR ${Math.round(P.thr*100)}%`);
 }
 // minimap (cockpit view: top-right, so it never covers the 3D panel's dials)
 const ms=Math.min(120*s,W*.1),mx=W-ms-18*s,my=camMode===1?60*s:H-ms-18*s;ctx.save();ctx.globalAlpha=.8;ctx.drawImage(mini,mx,my,ms,ms);ctx.globalAlpha=1;ctx.strokeStyle='rgba(124,255,178,.6)';ctx.lineWidth=2*s;ctx.strokeRect(mx,my,ms,ms);
 const M2=(x,z)=>[mx+(x+SZ/2)/SZ*ms,my+(z+SZ/2)/SZ*ms];ctx.fillStyle='#222';const a0=M2(-40,-RWY.hl),a1=M2(40,RWY.hl);ctx.fillRect(a0[0],a0[1],Math.max(2*s,a1[0]-a0[0]),a1[1]-a0[1]);
 gates.forEach((gt,i)=>{const q=M2(gt.p[0],gt.p[2]);ctx.fillStyle=i<gateIx?'#4dff88':i===gateIx?AMB:'#fff';ctx.beginPath();ctx.arc(q[0],q[1],(i===gateIx?4:2.5)*s,0,7);ctx.fill();});
 const q=M2(P.pos[0],P.pos[2]);ctx.translate(q[0],q[1]);ctx.rotate(hdg/DEG);ctx.fillStyle='#ff4b3a';ctx.beginPath();ctx.moveTo(0,-7*s);ctx.lineTo(5*s,6*s);ctx.lineTo(0,3*s);ctx.lineTo(-5*s,6*s);ctx.fill();ctx.restore();
 // pause + results overlays (drawn on the HUD canvas)
 if(state==='paused'){
  ctx.fillStyle='rgba(5,10,20,.55)';ctx.fillRect(0,0,W,H);
  const pw=520*s,ph=300*s,px=W/2-pw/2,py=H/2-ph/2;
  ctx.fillStyle='rgba(8,20,36,.92)';ctx.fillRect(px,py,pw,ph);ctx.strokeStyle='rgba(124,255,178,.4)';ctx.lineWidth=2*s;ctx.strokeRect(px,py,pw,ph);
  txt('PAUSED',W/2,py+52*s,30,G,'center',true);
  txt('W / S pitch · A / D roll · Q / E rudder',W/2,py+104*s,14,'#e8f4ff','center');
  txt('Shift / R throttle up · Z / F throttle down',W/2,py+132*s,14,'#e8f4ff','center');
  txt('G gear · C camera · Space brakes · M sound',W/2,py+160*s,14,'#e8f4ff','center');
  txt('P to resume · ENTER to restart',W/2,py+212*s,15,AMB,'center',true);
 }
 if((state==='done'||state==='campaign-done')&&landBd){
  {const vg=ctx.createLinearGradient(W*.35,0,W,0);vg.addColorStop(0,'rgba(5,10,20,0)');vg.addColorStop(1,'rgba(5,10,20,.55)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);}
  const pw=Math.min(620*s,W*.46),px=W-pw-28*s,cx=px+pw/2,ph0=540*s;
 const ph=Math.min(ph0,H-100*s),py=Math.max(50*s,(H-ph)/2-40*s),ks=ph/ph0;
  ctx.fillStyle='rgba(8,20,36,.94)';ctx.fillRect(px,py,pw,ph);ctx.strokeStyle='rgba(124,255,178,.45)';ctx.lineWidth=2*s;ctx.strokeRect(px,py,pw,ph);
  const camp=state==='campaign-done',tot=camp?campaignTotal(C):null;
  txt(camp?'CAMPAIGN COMPLETE!':'TOUCHDOWN!',cx,py+48*s*ks,34,'#7CFFB2','center',true);
  txt(camp?'All 3 sorties home — Runway 36':`Sortie ${C.sortie+1} complete — ${SORTIES[C.sortie].name}`,cx,py+74*s*ks,14,AMB,'center');
  const lx=px+40*s;ctx.textBaseline='alphabetic';
  const rows=camp?campaignRows(C,tot):sortieRows(landBd);
  let ry=py+118*s*ks;
  for(const r of rows){txt(r.label,lx,ry,15,G,'left',true);txt(r.value,px+pw-40*s,ry,15,G,'right',true);ry+=27*s*ks;}
  if(!camp&&landBd.dmg>0){txt(`HARD LANDING — AIRFRAME −${landBd.dmg}%`,lx,ry,14,'#ff6b5a','left',true);ry+=27*s*ks;}
  ctx.strokeStyle='rgba(124,255,178,.3)';ctx.beginPath();ctx.moveTo(lx,ry);ctx.lineTo(px+pw-40*s,ry);ctx.stroke();ry+=30*s*ks;
  txt(camp?'CAMPAIGN TOTAL':'SORTIE TOTAL',lx,ry,18,AMB,'left',true);
  txt(String(camp?tot.total:landBd.total),px+pw-40*s,ry,28,'#ffd27a','right',true);ry+=34*s*ks;
  const fn=featsEarned(C);
  if(fn>0){txt(`FEATS  ${fn} / 9  ·  ${FEATS.filter(f=>C.feats[f.id]).map(f=>f.name).join(' · ')}`,cx,ry,11,AMB,'center');ry+=20*s*ks;}
  // glidepath graph: flown approach trace vs the ideal 3.0° glidepath
  const gx0=px+40*s,gw=pw-80*s,gy0=ry,gh=150*s*ks;
  txt(`APPROACH TRACE — ${landBd.glide?landBd.glide.verdict:'NO TRACE'}  ·  IDEAL 3.0°`,cx,gy0+2*s*ks,11,AMB,'center');
  const gy1=gy0+22*s*ks,gh2=gh-22*s*ks;
  ctx.strokeStyle='rgba(232,244,255,.35)';ctx.lineWidth=1*s;ctx.strokeRect(gx0,gy1,gw,gh2);
  const X=d=>gx0+(1-clamp(d/2000,0,1))*gw,Y=h=>gy1+gh2-clamp(h/300,0,1)*gh2;
  ctx.setLineDash([6*s,5*s]);ctx.strokeStyle=AMB;ctx.beginPath();ctx.moveTo(X(2000),Y(2000*Math.tan(3/DEG)));ctx.lineTo(X(0),Y(0));ctx.stroke();ctx.setLineDash([]);
  if(trace.length>1){ctx.strokeStyle='#2ee6ff';ctx.lineWidth=2.5*s;ctx.shadowColor='#2ee6ff';ctx.shadowBlur=5*s;ctx.beginPath();
   trace.forEach((p,i)=>{const xx=X(p.d),yy=Y(p.h);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.stroke();ctx.shadowBlur=0;
   const lp=trace[trace.length-1];ctx.fillStyle='#2ee6ff';ctx.beginPath();ctx.arc(X(lp.d),Y(lp.h),4*s,0,7);ctx.fill();}
  txt('2000 m',gx0,gy1+gh2+16*s*ks,10,G,'left');txt('THRESHOLD',gx0+gw,gy1+gh2+16*s*ks,10,G,'right');txt('300 m',gx0-6*s,gy1+10*s*ks,10,G,'right');
  txt(camp?`TIME ${fmtT(tRun)}${tot.total>best?'  ·  NEW BEST!':''}   ·   Press ENTER to fly again`:`TIME ${fmtT(tRun)}   ·   Press ENTER — ${C.failed?'campaign over':C.sortie>=2?'campaign debrief':'turnaround'}`,cx,py+ph-24*s*ks,14,'#e8f4ff','center');
 }
 if(SHOW_FPS)txt('FPS '+RG.perf.fps+' · '+RG.perf.calls+' calls · '+(RG.perf.tris/1000).toFixed(0)+'k tris',W-16*s,30*s,13,'#e8f4ff','right',true);
}

// ================= loop / input =================
const ov=document.getElementById('ov'),ovmsg=document.getElementById('ovmsg');
function showOv(title,m){ov.querySelector('h1').textContent=title;ovmsg.textContent=m;ov.classList.remove('hide');}

// ---------- campaign overlays (dispatch board, turnaround, final card) ----------
// Serif italic titles + monospace data, teal/amber/coral on deep navy (Phase 3).
function ovHTML(inner){ov.querySelector('.box').innerHTML=inner;ov.classList.remove('hide');}
const serif="font-family:Georgia,'Times New Roman',serif;font-style:italic;";
function showDispatch(){
  const s=SORTIES[C.sortie];
  const rows=SORTIES.map((x,i)=>{
    const st=C.status[i],sc=C.scores[i];
    return `<tr><td style="color:${st==='FLOWN'?'#7CFFB2':st==='NEXT'?'#ffd27a':'#5a6b7a'}">${i+1}</td><td style="text-align:left"><b>${x.name}</b> · ${x.place}<br><span style="opacity:.75">${x.brief}</span></td><td>${st}</td><td>${st==='FLOWN'?sc.toLocaleString('en-US'):st==='NEXT'?x.par+' S PAR':'—'}</td></tr>`;}).join('');
  ovHTML(`<h1 style="${serif}">SKYLINE RUNNER</h1>
  <div class="sub">CAMPAIGN · 3 SORTIES · 28 RINGS · FUEL + DAMAGE · 3D COCKPIT</div>
  <div id="ovmsg">Dispatch — ${s.name}. ${s.brief}</div>
  <table>${rows}</table>
  <div style="margin-top:14px;font-size:14px">FUEL <b style="color:#ffc25a">${Math.round(C.fuelKg)} KG</b> / ${C.tankKg} KG &nbsp;·&nbsp; AIRFRAME <b style="color:#7CFFB2">${Math.round(C.airframe)}%</b> &nbsp;·&nbsp; REFITS ${C.refits.length} &nbsp;·&nbsp; FEATS ${featsEarned(C)}/9${best?` &nbsp;·&nbsp; BEST ${best.toLocaleString('en-US')}`:''}</div>
  <div class="go">Press ENTER or click — fly SORTIE ${C.sortie+1}: ${s.name}</div>`);
  state='dispatch';
}
function showRefit(){
  const cards=refitChoices.map((r,i)=>`<tr><td style="color:#ffd27a">${i+1}</td><td style="text-align:left"><b>${r.name}</b><br><span style="opacity:.75">${r.desc}</span></td></tr>`).join('');
  ovHTML(`<h1 style="${serif}">TURNAROUND</h1>
  <div class="sub">PAK DAR'S HANGAR · SORTIE ${C.sortie+1} DONE · PICK ONE REFIT</div>
  <div id="ovmsg">Sortie ${C.sortie+1} total ${C.scores[C.sortie].toLocaleString('en-US')} — fuel ${Math.round(C.fuelKg)} kg, airframe ${Math.round(C.airframe)}%.</div>
  <table>${cards}</table>
  <div class="go">Press 1, 2 or 3 to fit it</div>`);
  state='refit';
}
function pickRefit(i){
  const r=refitChoices[i];if(!r)return;
  applyRefit(C,r);say(`REFIT FITTED — ${r.name}`,3);
  C.sortie++;showDispatch();
}
function showCampaignDone(){
  const tot=campaignTotal(C);
  if(tot.total>best){best=tot.total;try{localStorage.setItem('sr_best_campaign',String(best))}catch(e){}}
  const rows=campaignRows(C,tot).map(r=>`<tr><td style="text-align:left">${r.label}</td><td>${r.value}</td></tr>`).join('');
  const fl=FEATS.filter(f=>C.feats[f.id]).map(f=>f.name).join(' · ')||'—';
  ovHTML(`<h1 style="${serif}">CAMPAIGN COMPLETE</h1>
  <div class="sub">ALL 3 SORTIES HOME · RUNWAY 36</div>
  <div id="ovmsg">Campaign total <b style="color:#ffd27a">${tot.total.toLocaleString('en-US')}</b>${tot.total>=best?' — NEW BEST!':''}</div>
  <table>${rows}</table>
  <div style="margin-top:14px;font-size:14px">FEATS ${featsEarned(C)}/9 — ${fl}</div>
  <div class="go">Press ENTER or click to fly the campaign again</div>`);
  state='campaign-done';
}
function bingoChoose(n){
  if(!bingoOpen)return;
  bingoOpen=false;C.bingoAnswered=true;awardFeat(C,'bingo-call');
  if(n===1){C.straightIn=true;gateIx=gates.length;say('STRAIGHT IN — land now, fuel is on you',4);}
  else{C.bingoPressedOn=true;say('PRESS ON — fuel is on you, 07',3);}
}
function start(){try{window.focus();hc.focus();}catch(e){}initAudio();if(AC&&AC.state==='suspended')AC.resume();
 if(state==='refit')return; // pick a refit first (keys 1/2/3)
 if(state==='done'){advanceAfterDebrief();return;}
 if(state==='campaign-done'){newCampaignStart();return;}
 if(state==='crashed'){C.fuelKg=Math.max(C.fuelKg,120);C.airframe=Math.max(50,C.airframe-10);}
 flySortie(C.sortie);}
ov.addEventListener('click',start);
addEventListener('keydown',e=>{keys[e.code]=true;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
 if(e.code==='Enter'&&state!=='fly')start();else if(e.code==='Enter'&&state==='fly'){reset();}
 if(e.code==='Digit1'||e.code==='Digit2'||e.code==='Digit3'){
   if(state==='refit')pickRefit(+e.code.slice(-1)-1);
   else if(state==='fly'&&bingoOpen)bingoChoose(+e.code.slice(-1));
 }
 if(e.code==='KeyC')camMode^=1;if(e.code==='KeyM')muted=!muted;
 if(e.code==='KeyG'&&state==='fly'){gearDown=!gearDown;say(gearDown?'GEAR DOWN':'GEAR UP — lower it before landing!',2);}
 if(e.code==='KeyP'){if(state==='fly')state='paused';else if(state==='paused')state='fly';}});
addEventListener('keyup',e=>keys[e.code]=false);
addEventListener('blur',()=>{for(const k in keys)keys[k]=false;});
hc.addEventListener('mousedown',e=>{if(e.button===0&&state==='fly')mouse.down=true;});
addEventListener('mouseup',()=>mouse.down=false);
addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;});
addEventListener('wheel',e=>{if(state==='fly')P.thr=clamp(P.thr-e.deltaY*.0006,0,1);},{passive:true});
function updAudio(){if(!AC)return;const on=!muted&&state==='fly',T=AC.currentTime;const f=48+P.thr*85+P.v*.25;
 eng.frequency.setTargetAtTime(f,T,.1);eng2.frequency.setTargetAtTime(f*.5,T,.1);engG.gain.setTargetAtTime(on?.04+P.thr*.08:0,T,.15);windG.gain.setTargetAtTime(on?clamp(P.v/120,0,1)*.1:0,T,.2);}
initRenderer(RG);
reset();showDispatch();let last=performance.now();
function frame(t){const dt=Math.min(.05,(t-last)/1000);last=t;
 const ft=window.__shotMode?12000:t;
 if(window.__selftest&&!window.__selftest.done){requestAnimationFrame(frame);return;} // sim-only: the tick loop renders every 200 ticks (SwiftShader is slow)
 if(state==='paused'){syncG();renderFrame(RG,ft);hud(ft);requestAnimationFrame(frame);return;}
 if(!window.__shotMode){const st=Math.max(1,Math.ceil(dt/.01));for(let i=0;i<st;i++)update(dt/st);}
 syncG();renderFrame(RG,ft);hud(ft);updAudio();requestAnimationFrame(frame);}
requestAnimationFrame(frame);

// ---------- screenshot staging (?shot=cover|ring|play|end) ----------
// Sets the real game state directly, then freezes the sim (window.__shotMode)
// so the staged frame is the screenshot. Deterministic: same scene, same frame.
function stageLookAt(tx,ty,tz){P.F=norm([tx-P.pos[0],0,tz-P.pos[2]]);P.U=[0,1,0];ortho();}
function stageBank(deg){rotAll(P.F,deg/DEG,['R','U']);ortho();}
window.SkyShots={stage:function(name){
 window.__shotMode=true;window.__shotStaged=true;ov.classList.add('hide');state='fly';
 const snapCam=()=>{const Ub=norm(add(scl(P.U,.55),[0,.45,0]));RG.camPos=add(add(P.pos,scl(P.F,-23)),scl(Ub,6.5));};
 if(name==='cover'){
  startSortie(0);reset();P.pos=[0,RWY.y+2.2,540];P.v=34;P.thr=1;gearDown=true;camMode=0;tRun=8;score=0;gateIx=0;combo=0;
  P.vs=vsS=1.6;snapCam();say('ROTATE — PULL UP',99);
 }else if(name==='ring'){
  startSortie(0);reset();gateIx=5;combo=5;ringsScore=1750;score=1750;tRun=65;gearDown=false;camMode=0;
  const g2=gates[5];P.pos=[g2.p[0]-g2.d[0]*260,g2.p[1]-10,g2.p[2]-g2.d[2]*260];P.v=55;P.thr=.7;
  stageLookAt(g2.p[0],g2.p[1],g2.p[2]);stageBank(35);
  snapCam();popups.push({p:g2.p.slice(),text:'+500',t:.8});
  P.vs=vsS=2.4;say('RING 6 / 12 — BANK INTO THE TURN',99);
 }else if(name==='play'){
  startSortie(0);reset();gateIx=10;combo=10;ringsScore=4750;score=4750;tRun=130;gearDown=false;camMode=1;
  const g7=gates[10];P.pos=[g7.p[0]-g7.d[0]*350,g7.p[1]-15,g7.p[2]-g7.d[2]*350];P.v=60;P.thr=.65;
  stageLookAt(g7.p[0],g7.p[1],g7.p[2]);
  P.vs=vsS=.8;snapCam();say('RING 11 / 12 — ON COURSE',99);
 }else if(name==='end'){
  // A finished campaign: all 3 sorties flown, real totals, campaign card.
  Object.assign(C,newCampaign());
  C.status=['FLOWN','FLOWN','FLOWN'];C.scores=[7330,6210,5840];C.fuelKg=140;
  C.feats={'first-light':true,'on-rails':true,'greaser':true,'storm-rider':true,'clean-sheet':true,'all-home':true};
  C.sortie=2;startSortie(2);reset();gateIx=6;combo=6;ringsScore=2250;tRun=151.4;gearDown=true;camMode=0;
  P.pos=[3.1,RWY.y+2.2,120];P.v=0;P.thr=0;P.grounded=true;stageLookAt(3.1,RWY.y+2.2,-400);P.vs=vsS=0;
  trace=[];for(let d=2000;d>=0;d-=80){const ideal=d*Math.tan(3/DEG);trace.push({d,h:Math.max(0,ideal+Math.sin(d/260)*9*(d/2000)+(d>1300?14:0))});}
  touchVs=-1.3;touchX=3.1;
  const lr=landingRows(touchVs,touchX,Math.max(0,Math.round(TIME_LIMIT-tRun))*5);
  landBd={rings:ringsScore,ringsHit:6,ringsTotal:6,sink:lr.sink,centre:lr.centre,time:lr.time,speed:0,flare:0,touchVs,centreX:touchX,total:7330,sortie:2,dmg:0,glide:glidepath(trace)};
  score=7330;C.scores[2]=7330;state='campaign-done';
  RG.camPos=[-45,38,240];msgT=0;
 }
}};
// fallback staging if shots.js runs before this script defines SkyShots
(function(){const q=new URLSearchParams(location.search),shot=q.get('shot');if(shot&&window.SkyShots&&!window.__shotStaged)window.SkyShots.stage(shot);})();

// ---------- self-test (?selftest=1): scripted autopilot flies the whole loop ----------
// Drives the real update() with synthetic keys; reports milestones to the console
// and document.title. Used by the Node smoke test and headless-Chrome verification.
window.__selftest=null;
(function(){
 const q=new URLSearchParams(location.search);if(q.get('selftest')!=='1')return;
 window.__selftest={log:[],done:false,reported:false};
 const ST=window.__selftest;
 const log=m=>{ST.log.push(m);console.log('[SELFTEST] '+m);};
 const hdgTo=(tx,tz)=>(Math.atan2(tx-P.pos[0],-(tz-P.pos[2]))*DEG+360)%360;
 const hdgNow=()=>(Math.atan2(P.F[0],-P.F[2])*DEG+360)%360;
 const hdgErr=t=>{let e=t-hdgNow();while(e>180)e-=360;while(e<-180)e+=360;return e;};
 let phase='takeoff',phaseT=0,gearSet=false,lastGate=0;
 ST.step=function(dt){
  phaseT+=dt;
  for(const k of ['KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','ShiftLeft','KeyR','KeyZ','KeyF','Space'])keys[k]=false;
  if(bingoOpen)bingoChoose(2); // self-test always presses on past BINGO
  // proportional controllers: hold a bank/pitch angle, don't hold the key down
  const bank=()=>Math.atan2(-P.R[1],P.U[1]);
  const pitch=()=>Math.asin(clamp(P.F[1],-1,1));
  const steer=(tgtX,tgtZ,altWant,thrWant)=>{
   const err=hdgErr(hdgTo(tgtX,tgtZ));
   const bankWant=clamp(err*0.02,-0.5,0.5),b=bank();
   if(bankWant-b>0.05)keys.KeyD=true;else if(bankWant-b<-0.05)keys.KeyA=true;
   const pitchWant=clamp((altWant-P.pos[1])*0.01,-0.4,0.6),p=pitch();
   if(pitchWant-p>0.04)keys.KeyS=true;else if(pitchWant-p<-0.04)keys.KeyW=true;
   keys.ShiftLeft=P.thr<thrWant;if(P.thr>thrWant)keys.KeyZ=true;
  };
  if(phase==='takeoff'){
   keys.ShiftLeft=true;
   if(P.v>38){const p=pitch();if(0.35-p>0.04)keys.KeyS=true;else if(0.35-p<-0.04)keys.KeyW=true;
    if(P.pos[1]>RWY.y+60){phase='gates';phaseT=0;log('LIFTOFF alt='+P.pos[1].toFixed(0)+' v='+P.v.toFixed(0));}}
   if(phaseT>30){log('FAIL takeoff timeout v='+P.v.toFixed(1));ST.done=true;}
  }else if(phase==='gates'){
   if(!gearSet&&P.pos[1]>RWY.y+50){gearDown=false;gearSet=true;log('GEAR UP');}
   if(gateIx>=gates.length){phase='land';phaseT=0;log('ALL RINGS score='+score);return;}
   if(gateIx!==lastGate){lastGate=gateIx;log('RING '+gateIx+' score='+score+' pos='+P.pos.map(v=>v.toFixed(0)).join(','));}
   if(state==='crashed'){log('FAIL crashed at '+P.pos.map(v=>v.toFixed(0)).join(',')+' gateIx='+gateIx);ST.done=true;return;}
   const gt=gates[gateIx];
   const distG=len(sub(gt.p,P.pos));
   // terrain clearance along the approach segment to the gate (sampled): the
   // plane must stay above the highest ground between it and the gate, then
   // descend into the gate's own valley on final — a single gBelow floor
   // strands it above a ridge (v8 slalom lesson: 600 s circling one gate).
   const gBelow=groundAt(P.pos[0],P.pos[2]);
   let maxG=gBelow;
   for(let k=1;k<=8;k++){const fx=P.pos[0]+(gt.p[0]-P.pos[0])*k/8,fz=P.pos[2]+(gt.p[2]-P.pos[2])*k/8;maxG=Math.max(maxG,groundAt(fx,fz));}
   const safeAlt=distG>600?Math.max(gt.p[1]+100,maxG+120,gBelow+120):Math.max(gt.p[1]+5,maxG+45);
   steer(gt.p[0],gt.p[2],safeAlt,distG>800?.75:distG>300?.55:.45);
   if(phaseT>600){log('FAIL gates timeout gateIx='+gateIx);ST.done=true;}
  }else if(phase==='land'){
   if(!gearDown){gearDown=true;log('GEAR DOWN');}
   // final: steer at a near point on the centreline so the line-up converges
   // fast, and follow a 12% descent that merges into the 5.5% glidepath
   const distThresh=Math.max(0,P.pos[2]-RWY.hl);
   const gp=RWY.y+2.2+Math.max(0,distThresh*.055);
   const prof=RWY.y+2.2+Math.max(0,(P.pos[2]-200)*.12);
   // stay above 60 m until lined up, so the touchdown is on the tarmac
   const floor=Math.abs(P.pos[0])>40?RWY.y+40:0;
   const tgtAlt=Math.max(gp,prof,floor);
   steer(0,P.pos[2]-200,tgtAlt,.18);
   if(P.grounded)keys.Space=true;
   if(state==='done'){
     log('SORTIE '+(C.sortie+1)+' DONE total='+score+' fuel='+Math.round(C.fuelKg)+' airframe='+Math.round(C.airframe)+' feats='+featsEarned(C));
     if(C.sortie>=2){log('DONE campaign total='+campaignTotal(C).total+' feats='+featsEarned(C));ST.done=true;return;}
     // turnaround: auto-pick the first refit offered, fly the next sortie
     const offer=refitOffer(C);applyRefit(C,offer[0]);log('REFIT '+offer[0].name);
     C.sortie++;startSortie(C.sortie);reset();state='fly';
     phase='takeoff';phaseT=0;gearSet=false;lastGate=0;
     return;
   }
   if(state==='crashed'){log('FAIL crashed at '+P.pos.map(v=>v.toFixed(0)).join(',')+' gateIx='+gateIx);ST.done=true;}
   if(phaseT>240){log('FAIL land timeout state='+state+' pos='+P.pos.map(v=>v.toFixed(0)).join(',')+' v='+P.v.toFixed(1));ST.done=true;}
  }
  if(ST.done&&!ST.reported){ST.reported=true;document.title=(ST.log.some(l=>l.startsWith('FAIL'))?'SMOKE:FAIL ':'SMOKE:PASS ')+ST.log.join(' | ');}
 };
 let tickN=0;
 setTimeout(function tick(){
  if(ST.done)return;
  for(let i=0;i<600&&!ST.done;i++){ST.step(1/60);update(1/60);if(state==='done'||state==='crashed')break;}
  tickN++;
  if(!ST.done){if(tickN%200===0){syncG();renderFrame(RG,performance.now());hud(performance.now());}setTimeout(tick,0);}
  else{ // final frame + title (the DONE log returns early from ST.step, so the
    // title setter inside step never runs for a successful campaign)
   if(!ST.reported){ST.reported=true;document.title=(ST.log.some(l=>l.startsWith('FAIL'))?'SMOKE:FAIL ':'SMOKE:PASS ')+ST.log.join(' | ');}
   syncG();renderFrame(RG,performance.now());hud(performance.now());}
 },500);
 start();
})();
