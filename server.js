'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),WebSocket=require('ws');
const ROOT=path.join(__dirname,'public'),PORT=Number(process.env.PORT||3000),MAP=1200,MAX=40,TICK=30;
const guns=[{name:'手枪',damage:5,rate:.34,speed:135,mag:15,range:155,reload:1.5},{name:'突击步枪',damage:3,rate:.11,speed:185,mag:50,range:145,reload:2},{name:'加特林',damage:2.5,rate:.065,speed:155,mag:100,range:130,reload:6},{name:'狙击枪',damage:30,rate:1.6,speed:310,mag:10,range:310,reload:2.6},{name:'霰弹枪',damage:7,rate:.85,speed:155,mag:6,range:62,reload:2.1}];
const {flameOffset,FIRE_SIZE,dashDistance,shieldFrontReduction}=require("./public/skill-geometry.cjs");
const SHIELD=5, SKILL_CD={flame:25,phase:22,shield:12,twin:35,sage:30,vampire:30,blackhole:25};
const REVIVE_TIME=8, REVIVE_RANGE=8, HEAL_RADIUS=16;
const UPGRADE_TYPES=['cd','damage','defense','hp'];
const upgradeText={cd:'技能冷却 -10%',damage:'伤害 +12%',defense:'减伤 +8%',hp:'最大生命 +20'};
const weaponOf=a=>a.gun===SHIELD?{name:"盾牌",damage:18,rate:.75,range:6,reload:0,mag:0}:guns[a.gun];
const phased=(room,a)=>a.phaseUntil>room.elapsed;
const fireContains=(room,f,a)=>room.elapsed+1e-8>=f.start&&room.elapsed<f.end-1e-8&&Math.abs(a.x-f.x)<=FIRE_SIZE/2&&Math.abs(a.z-f.z)<=FIRE_SIZE/2;
const fireSlow=(room,a)=>room.fires.some(f=>fireContains(room,f,a))?.4:1;
const dashing=a=>!!a.dash&&a.alive;
// The front half of the shield is defined by the direction the avatar faces.
function directionalDamage(a,amount,sx,sz,ordinaryArmor=false){
 const len=Math.hypot(sx,sz),facing=Math.hypot(a.aimX,a.aimZ);
 if(a.character==='shield'&&len>0&&facing>0&&(sx*a.aimX+sz*a.aimZ)/(len*facing)>1e-8)return amount*(1-shieldFrontReduction(a.helmet,a.armor));
 return amount*(ordinaryArmor?1-.05*(a.helmet+a.armor):1);
}
const rooms=new Map();const sessions=new Map();const GRACE_MS=90000;let uid=1;const rand=(a,b)=>a+Math.random()*(b-a),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

function obstacles(){
 const out=[];let seed=823421;const r=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);const add=(x,z,w,d,h,kind)=>out.push({x,z,w,d,h,kind});
 for(let i=0;i<4;i++){const cx=[-350,350,-350,350][i],cz=[-350,-350,350,350][i];for(let j=0;j<20;j++){let x=cx+(r()-.5)*380,z=cz+(r()-.5)*380,w=15+r()*23,d=15+r()*22;add(x,z,w,d,9+r()*18,['plant','factory','home','park'][i])} }
 for(let i=0;i<110;i++){let x=(r()-.5)*1100,z=(r()-.5)*1100;if(Math.abs(x)<45||Math.abs(z)<45)continue;add(x,z,4+r()*14,3+r()*6,2+r()*4,'wall')}return out
}
const OBSTACLES=obstacles();
const SQUAD_MAP=900;
function buildSquadLayout(){
 const obstacles=[],regions=[];const add=o=>obstacles.push(o),label=(name,x,z,color='#eef6ff')=>regions.push({name,x,z,color});
 const propColors={industrial:'factory',nuclear:'plant',commercial:'home',residential:'home',villa:'home',warehouse:'factory',park:'park',campus:'home'};
 function addProp(theme,x,z,w,d,h=5,kind=null){add({x,z,w,d,h,kind:kind||propColors[theme]||'wall',theme});}
 function addBuilding(x,z,w,d,theme,height=7.4,loot=0){const t=1.8,door=Math.max(5,Math.min(9,Math.round(w*.3)));const count=loot||Math.max(2,Math.min(6,Math.round(w*d/120)));add({x,z,w,d,h:height,kind:'houseRoof',walkable:true,theme,loot:count});add({x:x-w/2,z,w:t,d,h:height-.4,kind:'houseWall',theme});add({x:x+w/2,z,w:t,d,h:height-.4,kind:'houseWall',theme});add({x,z:z-d/2,w,d:t,h:height-.4,kind:'houseWall',theme});const side=(w-door)/2;add({x:x-(door/2+side/2),z:z+d/2,w:side,d:t,h:height-.4,kind:'houseWall',theme});add({x:x+(door/2+side/2),z:z+d/2,w:side,d:t,h:height-.4,kind:'houseWall',theme});}
 function grid(cx,cz,rows,cols,sx,sz,theme,minW,maxW,minD,maxD){for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const x=cx+(c-(cols-1)/2)*sx+(r%2?4:-4),z=cz+(r-(rows-1)/2)*sz;const w=minW+((r*7+c*5)%3)/(2||1)*(maxW-minW);const d=minD+((r*11+c*3)%4)/(3||1)*(maxD-minD);addBuilding(x,z,w,d,theme,7.2+(c%2)*.4);}}
 label('核电站',-300,-300,'#f4f5ff');
 addBuilding(-350,-315,46,28,'nuclear',8.2,5);addBuilding(-300,-315,32,22,'nuclear',7.9,4);addBuilding(-250,-315,42,24,'nuclear',8.2,5);
 addBuilding(-340,-260,30,20,'nuclear',7.6,4);addBuilding(-286,-260,28,20,'nuclear',7.6,4);addBuilding(-238,-258,26,18,'nuclear',7.2,3);
 addProp('nuclear',-315,-350,18,18,10,'plant');addProp('nuclear',-270,-350,16,16,10,'plant');addProp('nuclear',-220,-282,14,12,7,'factory');
 label('中央公园',15,-292,'#eaffea');
 addBuilding(-30,-318,22,16,'park',6.8,2);addBuilding(20,-322,24,18,'park',6.8,2);addBuilding(70,-316,22,16,'park',6.8,2);
 addBuilding(-45,-260,24,18,'park',6.8,2);addBuilding(25,-252,30,20,'park',7.1,3);addBuilding(78,-258,22,16,'park',6.8,2);
 addProp('park',0,-290,46,24,4,'park');addProp('park',40,-285,10,10,6,'park');addProp('park',-50,-288,10,10,6,'park');
 label('商业街',298,-255,'#fff1d8');
 grid(292,-280,2,3,46,48,'commercial',22,30,16,22);grid(292,-220,2,3,46,48,'commercial',22,30,16,22);
 addProp('commercial',250,-250,14,10,6,'home');addProp('commercial',332,-250,14,10,6,'home');
 label('河畔住宅区',-300,25,'#eff7ff');
 grid(-305,-10,2,3,48,56,'residential',22,30,18,24);grid(-305,85,2,3,48,56,'residential',22,30,18,24);grid(-305,170,1,3,48,56,'residential',24,32,18,24);
 label('仓储区',0,18,'#f0f0f0');
 addBuilding(-64,-10,34,24,'warehouse',7.8,4);addBuilding(0,-10,38,26,'warehouse',7.8,5);addBuilding(64,-10,34,24,'warehouse',7.8,4);addBuilding(-64,60,34,24,'warehouse',7.8,4);addBuilding(0,60,42,28,'warehouse',8.1,5);addBuilding(64,60,34,24,'warehouse',7.8,4);
 label('湖景别墅区',302,55,'#fff7fb');
 grid(302,20,2,2,60,62,'villa',26,34,20,26);grid(302,120,2,2,60,62,'villa',26,34,20,26);
 label('工厂区',-258,295,'#e8eef6');
 addBuilding(-325,260,34,24,'industrial',7.8,4);addBuilding(-270,258,30,22,'industrial',7.6,4);addBuilding(-215,258,30,22,'industrial',7.6,4);addBuilding(-325,325,38,24,'industrial',8.0,5);addBuilding(-265,330,28,20,'industrial',7.4,3);addBuilding(-215,325,36,22,'industrial',7.8,4);
 addProp('industrial',-285,290,14,14,8,'factory');addProp('industrial',-240,290,16,12,8,'factory');
 label('学院社区',110,286,'#eef2ff');
 grid(90,252,2,3,46,52,'campus',24,32,18,24);grid(120,340,1,2,62,50,'campus',30,36,22,24);addBuilding(190,294,26,18,'campus',7,3);addBuilding(22,318,24,18,'campus',7,3);
 // Edge fillers to increase playable compounds and indoor loot density.
 for(const x of [-120,120]){for(const z of [-120,120,200])addBuilding(x,z,24+((z+400)%3)*4,18+((x+200)%2)*4,'residential',7.1);}
 // Open blocking objects that shape cover, but keep roads playable.
 for(const x of [-180,180]){addProp('industrial',x,0,18,8,4,'wall');addProp('industrial',x,150,18,8,4,'wall');}
 return {obstacles,regions};
}
const {obstacles:SQUAD_OBSTACLES,regions:SQUAD_REGIONS}=buildSquadLayout();

function blocked(x,z,room){const size=room?.mapSize||MAP,objects=room?.obstacles||OBSTACLES;if(Math.abs(x)>size/2-5||Math.abs(z)>size/2-5)return true;return objects.some(o=>!o.walkable&&Math.abs(x-o.x)<o.w/2+2&&Math.abs(z-o.z)<o.d/2+2)}
function free(x,z,room){for(let i=0;i<60;i++){const p={x:clamp(x+rand(-35,35),-(room?.mapSize||MAP)/2+20,(room?.mapSize||MAP)/2-20),z:clamp(z+rand(-35,35),-(room?.mapSize||MAP)/2+20,(room?.mapSize||MAP)/2-20)};if(!blocked(p.x,p.z,room))return p}return {x:0,z:0}}
function item(type,x,z,level=0){return {id:uid++,type,x,z,level}}function lootAround(room,x,z,count=1){for(let i=0;i<count;i++){const p=free(x+rand(-9,9),z+rand(-9,9),room);let r=Math.random(),type=r<.21?'helmet':r<.40?'armor':r<.70?'gun':r<.94?'med':r<.975?'ammo':'special';let lv=type==='gun'?(rGunLevel()):type==='helmet'||type==='armor'?(Math.random()<.74?1:2):type==='special'?(Math.random()<.5?1:2):0;room.loot.push(item(type,p.x,p.z,lv))}}
function statScale(a,key,step){return 1+(a?.buffs?.[key]||0)*step}
function cdScale(a){return Math.max(.6,1-(a?.buffs?.cd||0)*.1)}
function applyUpgrade(a,type){a.buffs ||= {cd:0,damage:0,defense:0,hp:0};if(!(type in a.buffs))return false;a.buffs[type]++;if(type==='hp'){a.maxHp=(a.maxHp||100)+20;a.hp=Math.min(a.maxHp,a.hp+20);}return true}
function rollIndoorLoot(count=2){const out=[];for(let i=0;i<count;i++){let r=Math.random(),type=r<.21?'helmet':r<.40?'armor':r<.70?'gun':r<.94?'med':r<.975?'ammo':'special';let lv=type==='gun'?(rGunLevel()):type==='helmet'||type==='armor'?(Math.random()<.74?1:2):type==='special'?(Math.random()<.5?1:2):0;out.push({type,level:lv});}return out}
function makeChest(kind,x,z,items,extra={}){return {id:uid++,kind,x,z,items,opened:false,...extra}}
function chestSpots(roof){const pts=[];const cols=Math.max(1,Math.min(3,Math.round(roof.w/16))),rows=Math.max(1,Math.min(3,Math.round(roof.d/16)));for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){pts.push({x:roof.x+(c-(cols-1)/2)*Math.min(8,roof.w*.22),z:roof.z+(r-(rows-1)/2)*Math.min(8,roof.d*.22)});}return pts}
function spawnIndoorChests(room){room.chests=[];for(const roof of room.obstacles){if(roof.kind!=='houseRoof')continue;const chance=Math.min(.92,.42+(roof.loot||2)*.09);if(Math.random()>chance)continue;const spots=chestSpots(roof);const pick=spots[Math.floor(Math.random()*spots.length)]||{x:roof.x,z:roof.z};const itemCount=Math.max(1,Math.min(4,Math.round((roof.loot||2)/2)));room.chests.push(makeChest('indoor',pick.x,pick.z,rollIndoorLoot(itemCount),{theme:roof.theme}));if((roof.loot||0)>=5&&Math.random()<.35){const second=spots[(1+Math.floor(Math.random()*Math.max(1,spots.length-1)))%spots.length]||pick;room.chests.push(makeChest('indoor',second.x,second.z,rollIndoorLoot(Math.max(1,itemCount-1)),{theme:roof.theme}));}}
}
function createDeathChest(room,a){const items=[];if(a.helmet)items.push({type:'helmet',level:a.helmet});if(a.armor)items.push({type:'armor',level:a.armor});if(a.special)items.push({type:'special',level:a.special});for(let k=0;k<a.med;k++)items.push({type:'med',level:0});for(let g=1;g<guns.length;g++)if(a.owned[g])items.push({type:'gun',level:g});if(items.length)room.chests.push(makeChest('death',a.x,a.z,items,{ownerName:a.name}))}
function openChest(room,a,id){const chest=room.chests.find(c=>c.id===id&&!c.opened);if(!chest||!a.alive||a.rescue||dist(a,chest)>12)return false;chest.opened=true;const spread=chest.kind==='death'?0:2.6;const dropItems=chest.items||[];for(let i=0;i<dropItems.length;i++){const it=dropItems[i],angle=(Math.PI*2*i)/Math.max(1,dropItems.length),radius=spread?(i%2?spread:spread*.45):0;room.loot.push(item(it.type,chest.x+Math.cos(angle)*radius,chest.z+Math.sin(angle)*radius,it.level||0));}room.events.push({type:'chest',kind:chest.kind,x:chest.x,z:chest.z,byId:a.id,id:chest.id});return true}
function rollAirdropChest(){return [{type:'helmet',level:3},{type:'armor',level:3},{type:'gun',level:3},{type:'gun',level:2},{type:'special',level:Math.random()<.5?1:2},{type:'med',level:0}]}
function maybeStartUpgrade(room){if(room.mode!=='zombie'||room.upgrade||!room.wave||room.wave%3)return false;if(room.lastUpgradeWave===room.wave)return false;if(room.actors.some(a=>a.zombie&&a.alive))return false;const humans=room.actors.filter(a=>!a.bot);if(!humans.length)return false;const pool=[...UPGRADE_TYPES].sort(()=>Math.random()-.5).slice(0,3);room.upgrade={wave:room.wave,choices:pool,end:room.elapsed+15,chosen:{}};room.lastUpgradeWave=room.wave;room.events.push({type:'upgrade',wave:room.wave,choices:pool});return true}
function finalizeUpgrade(room){if(!room.upgrade)return;const humans=room.actors.filter(a=>!a.bot);const fallback=room.upgrade.choices[0];for(const a of humans){const pick=room.upgrade.chosen[a.id]||fallback;applyUpgrade(a,pick);}room.events.push({type:'upgradeDone',wave:room.upgrade.wave,chosen:room.upgrade.chosen});room.upgrade=null}
function pickUpgrade(room,a,type){if(room.mode!=='zombie'||!room.upgrade||a.bot||room.upgrade.chosen[a.id])return false;if(!room.upgrade.choices.includes(type))return false;room.upgrade.chosen[a.id]=type;room.events.push({type:'upgradePick',byId:a.id,choice:type});const humans=room.actors.filter(x=>!x.bot);if(humans.every(x=>room.upgrade.chosen[x.id]))finalizeUpgrade(room);return true}
// Gun loot weights: pistol 6%, assault 32%, minigun 28%, sniper 14%, shotgun 20%.
function rGunLevel(){const r=Math.random();return r<.06?0:r<.38?1:r<.66?2:r<.80?3:4}
function makeActor(team,bot,pos,name){return {id:uid++,team,bot,name,x:pos.x,z:pos.z,hp:100,maxHp:100,alive:true,gun:0,owned:[true,false,false,false,false],mag:[15,50,100,10,6],helmet:0,armor:0,special:0,med:0,aimX:1,aimZ:0,aiming:false,fire:false,shootAt:0,reloadUntil:0,healUntil:0,revive:0,deadAt:0,mode:'wander',tx:pos.x,tz:pos.z,think:0,kills:0,score:0,buffs:{cd:0,damage:0,defense:0,hp:0}}}
function makeRoom(code,mode,difficulty='easy'){return {code,mode,difficulty:mode==='duel'?'easy':difficulty,mapSize:SQUAD_MAP,status:'lobby',host:null,clients:new Map(),actors:[],loot:[],chests:[],bullets:[],events:[],obstacles:SQUAD_OBSTACLES,regions:SQUAD_REGIONS,zone:{x:0,z:0,r:mode==='duel'?205:440,stage:0,next:120,fromR:mode==='duel'?205:440,toR:mode==='duel'?205:440,shrinkStart:0,shrinkEnd:0},elapsed:0,fires:[],healingZones:[],ended:false,created:Date.now(),wave:0,nextWave:0,zombies:[],upgrade:null,lastUpgradeWave:0}}
function send(ws,o){if(ws.readyState===1)try{ws.send(JSON.stringify(o))}catch{}}
function broadcast(room,o){for(const ws of room.clients.keys()){if(ws.bufferedAmount<512*1024)send(ws,o)}}
const characters=['flame','phase','shield','twin','sage','vampire','blackhole'];
function selection(room){for(const [socket,player] of room.clients){send(socket,{type:'selection',character:player.character||null,ready:!!player.ready,players:[...room.clients.values()].map(p=>({name:p.name,character:p.character||null,ready:!!p.ready}))});}}
function checkReady(room){if(room.status==='selecting'&&room.clients.size&&[...room.clients.values()].every(p=>p.ready&&characters.includes(p.character)))start(room);}

function start(room){room.status='playing';room.elapsed=0;room.actors=[];room.loot=[];room.chests=[];room.bullets=[];room.events=[];room.fires=[];room.healingZones=[];room.drops=[];room.wave=0;room.nextWave=0;room.hordePhase="normal";room.upgrade=null;room.lastUpgradeWave=0;room.zone={x:0,z:0,r:room.mode==='duel'?205:440,stage:0,next:120,fromR:room.mode==='duel'?205:440,toR:room.mode==='duel'?205:440,shrinkStart:0,shrinkEnd:0};let members=[...room.clients.entries()];if(room.mode==='duel'&&members.length>2)members=members.slice(0,2);
const teams=room.mode==='duel'?2:room.mode==='zombie'?1:10,per=room.mode==='duel'?1:4;
for(let t=0;t<teams;t++){const angle=t*Math.PI*2/teams,rr=room.mode==='duel'?135:310,base=free(Math.cos(angle)*rr,Math.sin(angle)*rr,room);for(let k=0;k<per;k++){if(t===0&&room.mode!=='duel'&&k>=members.length)continue;let ws=null,info=null;if(t===0&&room.mode!=='duel'&&k<members.length)[ws,info]=members[k];if(room.mode==='duel'&&k===0&&t<members.length)[ws,info]=members[t];if(room.mode==='duel'&&t>=2)continue;if(room.mode==='duel'&&t===1&&members.length===1)ws=null;const p=free(base.x+rand(-9,9),base.z+rand(-9,9),room),a=makeActor(t,!ws,p,info?.name||`BOT-${t+1}-${k+1}`);a.character=info?.character||null;if(a.character==='shield'){a.gun=SHIELD;a.owned=[false,false,false,false,false,true];a.mag[SHIELD]=0;}room.actors.push(a);if(ws){info.actorId=a.id;send(ws,{type:'assigned',id:a.id,team:a.team})}}}
spawnIndoorChests(room)
broadcast(room,{type:'start',mode:room.mode,difficulty:room.difficulty,map:room.mapSize,obstacles:room.obstacles,regions:room.regions||[]});}

function drop(room,a){createDeathChest(room,a);}
function cancelRevive(room,a){if(!a.rescue)return;const t=room.actors.find(x=>x.id===a.rescue.target);if(t&&t.rescuer===a.id){t.rescuer=null;t.revive=0;}a.rescue=null;}
function human(a){return !a.bot&&!a.clone&&!a.zombie;}
function rescueEligible(room,a,t){return human(a)&&human(t)&&a.alive&&t.downed&&a.team===t.team&&a.id!==t.id&&dist(a,t)<=REVIVE_RANGE&&lineClear(a,t,room);}
function beginRevive(room,a,id){const t=room.actors.find(x=>x.id===id);if(!t||!rescueEligible(room,a,t)||a.rescue||t.rescuer||dashing(a)||phased(room,a))return false;a.reloadUntil=0;a.healUntil=0;a.aiming=false;a.fire=false;a.rescue={target:t.id,end:room.elapsed+REVIVE_TIME};t.rescuer=a.id;t.revive=0;return true;}
function updateRevives(room){for(const a of room.actors){if(!a.rescue)continue;const t=room.actors.find(x=>x.id===a.rescue.target);if(!t||!rescueEligible(room,a,t)||t.rescuer!==a.id){cancelRevive(room,a);continue;}t.revive=clamp(REVIVE_TIME-(a.rescue.end-room.elapsed),0,REVIVE_TIME);if(room.elapsed+1e-8>=a.rescue.end){cancelRevive(room,a);t.downed=false;t.alive=true;t.hp=30;t.deadAt=0;room.events.push({type:'revive',name:t.name,target:t.id,byId:a.id});}}}
function settleDowned(room){for(const a of room.actors){if(a.downed&&!room.actors.some(b=>human(b)&&b.team===a.team&&b.alive)){a.downed=false;a.rescuer=null;a.revive=0;}}}
function kill(room,a,attacker){if(!a.alive)return;cancelRevive(room,a);a.alive=false;a.dash=null;a.hp=0;a.deadAt=room.elapsed;a.revive=0;a.reloadUntil=0;a.healUntil=0;a.poisonUntil=0;a.slowUntil=0;a.zoneAcc=0;a.aiming=false;a.fire=false;a.downed=human(a)&&room.mode!=='duel'&&room.actors.some(b=>b!==a&&human(b)&&b.team===a.team&&b.alive);if(!a.zombie&&!a.clone&&!a.bat&&!(human(a)&&room.mode!=='duel'&&room.actors.some(b=>b!==a&&human(b)&&b.team===a.team)))drop(room,a);if(a.downed)room.events.push({type:'downed',name:a.name,target:a.id});settleDowned(room);if(a.anchor)finishAnchor(room,a);if(a.bat||a.zombie&&attacker?.zombie)return;if(attacker?.clone||attacker?.bat)attacker=room.actors.find(p=>p.id===attacker.ownerId)||attacker;if(attacker&&attacker!==a){attacker.kills++;if(a.zombie&&!attacker.bot){attacker.score=(attacker.score||0)+(a.boss?50:5)}if(a.boss){for(const g of [1+Math.floor(Math.random()*4),1+Math.floor(Math.random()*4)])room.loot.push(item('gun',a.x+rand(-4,4),a.z+rand(-4,4),g));room.loot.push(item('med',a.x+3,a.z,0))}room.events.push({type:a.downed?'knock':'kill',by:attacker.name,byId:attacker.id,name:a.name})}}
function wallHit(x,z,room){return blocked(x,z,room)}function lineClear(a,b,room){let d=dist(a,b),n=Math.ceil(d/4);for(let i=1;i<n;i++){let t=i/n;if(wallHit(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t,room))return false}return true}
function visible(a,b,range,room){return b.alive&&!phased(room,b)&&a.team!==b.team&&dist(a,b)<=range&&lineClear(a,b,room)}
function shoot(room,a){
 if(a.rescue)return;
 const g=weaponOf(a),boost=statScale(a,'damage',.12);
 if(a.gun===SHIELD){
  if(!a.alive||room.elapsed<a.shootAt||room.elapsed<a.healUntil)return;
  a.shootAt=room.elapsed+g.rate;
  const target=room.actors.filter(b=>visible(a,b,g.range,room)&&((b.x-a.x)*a.aimX+(b.z-a.z)*a.aimZ)/Math.max(.01,dist(a,b))>.35).sort((b,c)=>dist(a,b)-dist(a,c))[0];
  if(target)damage(room,target,directionalDamage(target,g.damage*boost,a.x-target.x,a.z-target.z),a);
  return;
 }
 if(!a.alive||room.elapsed<a.shootAt||room.elapsed<a.reloadUntil||room.elapsed<a.healUntil)return;
 if(a.mag[a.gun]<=0){a.reloadUntil=room.elapsed+g.reload;return}
 a.mag[a.gun]--;a.shootAt=room.elapsed+g.rate*(a.bot?({easy:1.75,normal:1.35,hard:1.05}[room.difficulty]||1.75):1);
 let dx=a.aimX,dz=a.aimZ,len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;
 for(let pellet=0;pellet<(a.gun===4?5:1);pellet++){
  const angle=a.gun===4?rand(-Math.PI/20,Math.PI/20):a.gun===2?rand(-Math.PI/18,Math.PI/18):0;
  const bx=dx*Math.cos(angle)-dz*Math.sin(angle),bz=dx*Math.sin(angle)+dz*Math.cos(angle);
  room.bullets.push({id:uid++,owner:a.id,team:a.team,x:a.x+bx*3,z:a.z+bz*3,dx:bx,dz:bz,life:g.range/g.speed,speed:g.speed,damage:g.damage*boost*(a.clone?.4:1),damageScale:boost*(a.clone?.4:1),special:a.special});
 }
}
function hit(room,b,a){let dmg=directionalDamage(a,b.damage*(b.special===2?1.2:1),-b.dx,-b.dz,true);if(!damage(room,a,dmg,room.actors.find(p=>p.id===b.owner)))return;if(a.alive&&b.special===1){a.poisonUntil=room.elapsed+3;a.poisonNext=room.elapsed+1;a.poisonOwner=b.owner;a.poisonDamage=5*(b.damageScale||1);a.slowUntil=room.elapsed+3}}

function containingRoof(room,a){return room.obstacles.find(o=>o.kind==='houseRoof'&&Math.abs(a.x-o.x)<=o.w/2&&Math.abs(a.z-o.z)<=o.d/2)||null;}
function doorwayOf(roof){return {x:roof.x,z:roof.z+roof.d/2+4};}
function navigateToward(room,a,goalX,goalZ,step,key='navHeading'){const dx=goalX-a.x,dz=goalZ-a.z,d=Math.hypot(dx,dz)||1;if(d<.05)return false;let direct=Math.atan2(dz,dx);const roof=containingRoof(room,a);if(roof){const out=doorwayOf(roof);if(Math.hypot(goalX-a.x,goalZ-a.z)>8&&!lineClear(a,{x:goalX,z:goalZ},room))direct=Math.atan2(out.z-a.z,out.x-a.x);}let best=null;for(const turn of [0,.28,-.28,.56,-.56,.9,-.9,1.25,-1.25,1.6,-1.6,2.2,-2.2,Math.PI]){const heading=direct+turn,x=a.x+Math.cos(heading)*step,z=a.z+Math.sin(heading)*step;if(blocked(x,z,room))continue;const lookX=x+Math.cos(heading)*Math.max(3,step*2),lookZ=z+Math.sin(heading)*Math.max(3,step*2);const continuity=a[key]===undefined?0:Math.abs(Math.atan2(Math.sin(heading-a[key]),Math.cos(heading-a[key])))*.35;const score=Math.abs(turn)*1.1+(blocked(lookX,lookZ,room)?.7:0)+continuity+Math.hypot(goalX-x,goalZ-z)/Math.max(8,d);if(!best||score<best.score)best={x,z,heading,score};}
 if(best){a.x=best.x;a.z=best.z;a[key]=best.heading;a.navBlocked=0;return true;}
 a.navBlocked=(a.navBlocked||0)+1;return false;}
function ai(room,a,dt){
 a.think-=dt;
 const nearby=room.actors.filter(b=>visible(a,b,b.bot?(a.gun===3?115:82):38,room)).sort((b,c)=>dist(a,b)-dist(a,c));
 let target=nearby[0];
 if(target){
  a.mode='fight';
  let dx=target.x-a.x,dz=target.z-a.z,l=Math.hypot(dx,dz)||1;
  const difficulty=room.mode==='duel'?'easy':room.difficulty;
  const jitter=({easy:a.gun===3?.18:.27,normal:a.gun===3?.12:.17,hard:a.gun===3?.055:.075}[difficulty]||.27);
  let angle=Math.atan2(dz,dx)+rand(-jitter,jitter);a.aimX=Math.cos(angle);a.aimZ=Math.sin(angle);a.aiming=true;
  if(a.think<=0){a.think=difficulty==='hard'?rand(.35,1.1):difficulty==='normal'?rand(.6,1.8):rand(.8,2.5);let side=Math.random()<.5?-1:1;a.tx=clamp(a.x+(-dz/l)*side*rand(8,22),-(room.mapSize/2-30),room.mapSize/2-30);a.tz=clamp(a.z+(dx/l)*side*rand(8,22),-(room.mapSize/2-30),room.mapSize/2-30)}
  if(Math.random()<({easy:.34,normal:.53,hard:.8}[difficulty]||.34))shoot(room,a)
 }else{
  a.mode='loot';a.aiming=false;
  if(a.think<=0){
   a.think=rand(2,5);
   const nearLoot=room.loot.filter(i=>dist(a,i)<90).sort((b,c)=>dist(a,b)-dist(a,c))[0];
   const nearChest=(room.chests||[]).filter(c=>!c.opened&&dist(a,c)<90).sort((b,c)=>dist(a,b)-dist(a,c))[0];
   let t=nearLoot||nearChest||{x:a.x+rand(-65,65),z:a.z+rand(-65,65)};
   if(Math.hypot(a.x-room.zone.x,a.z-room.zone.z)>room.zone.r-35)t=room.zone;
   a.tx=clamp(t.x,-(room.mapSize/2-25),room.mapSize/2-25);a.tz=clamp(t.z,-(room.mapSize/2-25),room.mapSize/2-25)
  }
 }
 let dx=a.tx-a.x,dz=a.tz-a.z,l=Math.hypot(dx,dz);
 if(l>2){let sp=target?6.4:8.7,step=sp*dt*fireSlow(room,a);navigateToward(room,a,a.tx,a.tz,step,'botHeading');}
 if(!target){const near=room.loot.find(i=>dist(a,i)<5);if(near)pickup(room,a,near.id,true);const chest=(room.chests||[]).find(i=>!i.opened&&dist(a,i)<6);if(chest)openChest(room,a,chest.id)}
}

function pickup(room,a,id,auto=false){let idx=room.loot.findIndex(i=>i.id===id);if(idx<0||!a.alive||a.rescue)return false;const it=room.loot[idx];if(dist(a,it)>11)return false;let ok=false;if(a.character==='shield'&&['gun','ammo','special'].includes(it.type))return false;if(it.type==='gun'&&Number.isInteger(it.level)&&it.level>=0&&it.level<guns.length){a.owned[it.level]=true;a.gun=it.level;a.mag[a.gun]=guns[a.gun].mag;ok=true}else if(it.type==='helmet'&&a.helmet===0){a.helmet=it.level;ok=true}else if(it.type==='armor'&&a.armor===0){a.armor=it.level;ok=true}else if(it.type==='special'&&a.special===0){a.special=it.level;ok=true}else if(it.type==='med'&&a.med<3){a.med++;ok=true}else if(it.type==='ammo'){a.mag[a.gun]=guns[a.gun].mag;ok=true}if(ok)room.loot.splice(idx,1);return ok}
function spawnZombieWave(room){
 room.wave++;room.nextWave=room.elapsed+35;
 const humans=room.actors.filter(a=>!a.bot&&a.alive);if(!humans.length)return;
 const count=Math.min(32,3+room.wave*2);
 for(let i=0;i<count;i++){
  const h=humans[i%humans.length],angle=rand(0,Math.PI*2),r=rand(28,55);
  const pos=free(h.x+Math.cos(angle)*r,h.z+Math.sin(angle)*r,room);
  const boss=room.wave%5===0&&i===0;
  const z=makeActor(99,true,pos,boss?'BOSS':'僵尸');
  z.zombie=true;z.boss=boss;z.hp=boss?360:35;z.maxHp=z.hp;z.gun=0;z.attackAt=0;z.speed=boss?5.8:6.5;z.score=0;
  room.actors.push(z);
 }
 room.events.push({type:'wave',wave:room.wave});
}

// Horde phase is authoritative and counts living zombies, not retained corpses.
function updateHordePhase(room){
 if(room.mode!=='zombie')return;
 const alive=room.actors.filter(a=>a.zombie&&a.alive);
 if((room.hordePhase||'normal')==='normal'&&alive.length>100){room.hordePhase='infighting';room.events.push({type:'hordeInfighting'});}
 if(room.hordePhase==='infighting'&&alive.length<=20){
  room.hordePhase='golden';
  for(const a of alive){a.golden=true;a.name='金色僵尸';a.hp=a.maxHp=100;a.speed=15*1.01;a.attackAt=room.elapsed+1.65;}
  room.events.push({type:'hordeGolden'});
 }
 if(room.hordePhase==='golden'&&!alive.length){room.hordePhase='normal';room.nextWave=room.elapsed;}
}
function zombieAI(room,a,dt){
 const infighting=room.hordePhase==='infighting';
 const targets=room.actors.filter(b=>b!==a&&b.alive&&(infighting?b.zombie:b.team!==a.team&&(!b.bot||b.clone||b.bat)&&!phased(room,b)));
 if(!targets.length)return;
 const t=targets.reduce((best,b)=>!best||dist(a,b)<dist(a,best)?b:best,null);
 const dx=t.x-a.x,dz=t.z-a.z,d=Math.hypot(dx,dz)||1;
 a.aimX=dx/d;a.aimZ=dz/d;
 if(d>3.8||!lineClear(a,t,room)){const step=a.speed*dt*fireSlow(room,a);navigateToward(room,a,t.x,t.z,step,'zombieHeading');}
 else if(room.elapsed>=a.attackAt){a.attackAt=room.elapsed+(a.golden?1.65:a.boss?1.2:1.65);const dmg=a.golden?40:a.boss?18:9;damage(room,t,directionalDamage(t,dmg,a.x-t.x,a.z-t.z),a);if(infighting)updateHordePhase(room);}
}
function damage(room,a,amount,attacker){
 if(!a.alive||phased(room,a))return false;
 const owner=attacker?.bat?room.actors.find(p=>p.id===attacker.ownerId):attacker;
 const reduced=Math.max(.1,amount*(1-((a.buffs?.defense||0)*.08)));
 const before=a.hp;
 a.hp=Math.max(0,a.hp-reduced);
 if(owner?.alive&&owner.character==='vampire'&&owner.team!==a.team){
  const prev=owner.hp;
  owner.hp=Math.min(owner.maxHp||100,owner.hp+(before-a.hp)*.15);
  const value=Math.round((owner.hp-prev)*100)/100;
  if(value>0)room.events.push({type:'healing',target:owner.id,team:owner.team,x:owner.x,z:owner.z,value});
 }
 room.events.push({type:'damage',x:a.x,z:a.z,value:Math.round((before-a.hp)*10)/10,target:a.id,byId:owner?.id||null,team:owner?.team??null});
 if(!a.hp)kill(room,a,attacker);
 return true;
}

function dash(room,a,dx,dz){if(!Number.isFinite(dx)||!Number.isFinite(dz))return false;const len=Math.hypot(dx,dz);if(!Number.isFinite(len)||len<.01)return false;dx/=len;dz/=len;a.aimX=dx;a.aimZ=dz;const distance=dashDistance(room.mode);a.dash={dx,dz,remaining:distance,time:.6,speed:distance/.6,hit:new Set()};return true;}
function updateDash(room,a,dt){if(!dashing(a))return;const d=a.dash,active=Math.min(dt,d.time),distance=Math.min(d.remaining,d.speed*active*fireSlow(room,a)),n=Math.max(1,Math.ceil(distance/.5));a.aimX=d.dx;a.aimZ=d.dz;for(let i=0;i<n;i++){const x=a.x+d.dx*distance/n,z=a.z+d.dz*distance/n;if(blocked(x,z,room)){a.dash=null;return;}a.x=x;a.z=z;for(const b of room.actors){if(!b.alive||b.team===a.team||d.hit.has(b.id)||phased(room,b)||dist(a,b)>2.5||!lineClear(a,b,room))continue;d.hit.add(b.id);damage(room,b,directionalDamage(b,20,-d.dx,-d.dz),a);}}d.remaining-=distance;d.time-=active;if(d.remaining<1e-8||d.time<1e-8)a.dash=null;}
function finishAnchor(room,a){a.anchor=null;a.skillUntil=room.elapsed+SKILL_CD.blackhole;}
function useSkill(room,a,m){if(!a.alive||a.rescue||!SKILL_CD[a.character]||room.elapsed<(a.skillUntil||0))return false;
 if(a.character==='flame'){if(![m.nx,m.ny,m.aspect].every(Number.isFinite))return false;const offset=flameOffset(m.nx,m.ny,m.aspect),edge=room.mapSize/2-5;room.fires.push({id:uid++,owner:a.id,team:a.team,damageScale:statScale(a,'damage',.12),x:clamp(a.x+offset.x,-edge,edge),z:clamp(a.z+offset.z,-edge,edge),start:room.elapsed+.5,end:room.elapsed+5.5,next:room.elapsed+.5});}
 else if(a.character==='phase'){a.phaseUntil=room.elapsed+4.8;a.poisonUntil=0;a.slowUntil=0;}
 else if(a.character==='shield'){if(!dash(room,a,m.dx,m.dz))return false;}
 else if(a.character==='sage'){room.healingZones.push({id:uid++,owner:a.id,team:a.team,x:a.x,z:a.z,r:HEAL_RADIUS,start:room.elapsed,end:room.elapsed+5});}
 else if(a.character==='blackhole'){
  if(a.anchor){if(room.elapsed>=a.anchor.end){finishAnchor(room,a);return false;}const {x,z}=a.anchor;a.x=x;a.z=z;a.teleportSeq=(a.teleportSeq||0)+1;finishAnchor(room,a);return true;}
  a.anchor={x:a.x,z:a.z,end:room.elapsed+8};return true;
 }
 else if(a.character==='vampire'){for(let i=0;i<4;i++){const angle=i*Math.PI/2,x=a.x+Math.cos(angle)*2,z=a.z+Math.sin(angle)*2;const pos=blocked(x,z,room)?{x:a.x,z:a.z}:{x,z};const b=makeActor(a.team,true,pos,a.name+' · 蝙蝠');b.bat=true;b.ownerId=a.id;b.hp=b.maxHp=8;b.speed=room.mode==='duel'?10:16.5;b.expires=room.elapsed+8;b.attackAt=room.elapsed;room.actors.push(b);}}
 else if(a.character==='twin'){let pos={x:a.x,z:a.z};for(let i=0;i<16;i++){const angle=i*Math.PI/8,x=a.x+Math.cos(angle)*4,z=a.z+Math.sin(angle)*4;if(!blocked(x,z,room)){pos={x,z};break;}}const c=makeActor(a.team,true,pos,a.name+' · 分身');c.clone=true;c.ownerId=a.id;c.character='twin';c.expires=room.elapsed+10;c.gun=a.gun;c.owned=[...a.owned];c.mag=[...a.mag];c.special=a.special;c.hp=100;room.actors.push(c);}
 a.skillUntil=room.elapsed+SKILL_CD[a.character]*cdScale(a);return true;
}
function cloneAI(room,a,dt){const owner=room.actors.find(b=>b.id===a.ownerId);const target=room.actors.filter(b=>b.alive&&b.team!==a.team&&!phased(room,b)).sort((b,c)=>dist(a,b)-dist(a,c))[0];const goal=target||owner;if(!goal||!goal.alive){a.aiming=false;return;}const dx=goal.x-a.x,dz=goal.z-a.z,d=Math.hypot(dx,dz);if(d<.01)return;a.aimX=dx/d;a.aimZ=dz/d;a.aiming=!!target;const canAttack=target&&d<=weaponOf(a).range&&lineClear(a,target,room);if(canAttack)shoot(room,a);if(d>(target?(canAttack?8:2):5)){const step=15*dt*fireSlow(room,a);navigateToward(room,a,goal.x,goal.z,step,'cloneHeading');}}
function batAI(room,a,dt){const owner=room.actors.find(b=>b.id===a.ownerId);if(!owner?.alive)return;let target=null,best=Infinity;for(const b of room.actors){if(!b.alive||b.team===a.team||phased(room,b))continue;const d=dist(a,b);if(d<best){best=d;target=b;}}const goal=target||owner,d=dist(a,goal);const angle=d<.01?Math.atan2(a.aimZ,a.aimX):Math.atan2(goal.z-a.z,goal.x-a.x);a.aimX=Math.cos(angle);a.aimZ=Math.sin(angle);if(target&&d<=3&&lineClear(a,target,room)){if(room.elapsed>=a.attackAt){a.attackAt=room.elapsed+1;damage(room,target,directionalDamage(target,3,a.x-target.x,a.z-target.z),a);}return;}if(!target&&d<3)return;const step=Math.min(d,(a.speed||16.5)*dt*fireSlow(room,a));navigateToward(room,a,goal.x,goal.z,step,'batHeading');}
function updateSkills(room){for(const a of room.actors)if(a.anchor&&(!a.alive||room.elapsed>=a.anchor.end))finishAnchor(room,a);room.actors=room.actors.filter(a=>!(a.clone||a.bat)||(a.alive&&room.elapsed<a.expires&&room.actors.some(b=>b.id===a.ownerId&&b.alive)));room.fires=room.fires.filter(f=>room.elapsed<f.end-1e-8);for(const f of room.fires){if(room.elapsed+1e-8<f.start||room.elapsed+1e-8<f.next)continue;f.next+=.5;const owner=room.actors.find(a=>a.id===f.owner);for(const a of room.actors){if(a.alive&&a.team!==f.team&&fireContains(room,f,a))damage(room,a,20*(f.damageScale||1),owner);}}}
function updateHealing(room,dt){const start=room.elapsed-dt;for(const a of room.actors){if(!a.alive){a.healFeedback=0;a.healFeedbackAt=null;continue;}let duration=0;for(const h of room.healingZones){if(a.team===h.team&&dist(a,h)<=h.r)duration=Math.max(duration,Math.max(0,Math.min(room.elapsed,h.end)-Math.max(start,h.start)));}if(duration>0){const before=a.hp;a.hp=Math.min(a.maxHp||100,a.hp+10*duration);const amount=a.hp-before;if(amount>0){if(a.healFeedbackAt==null)a.healFeedbackAt=start;a.healFeedback=(a.healFeedback||0)+amount;}}
 const ending=!room.healingZones.some(h=>a.team===h.team&&dist(a,h)<=h.r&&room.elapsed<h.end-1e-8);
 if(a.healFeedback>0&&(room.elapsed-a.healFeedbackAt>=1-1e-8||duration===0||ending)){const value=Math.round(a.healFeedback*10)/10;if(value>0)room.events.push({type:'healing',target:a.id,team:a.team,x:a.x,z:a.z,value});a.healFeedback=0;a.healFeedbackAt=null;}}room.healingZones=room.healingZones.filter(h=>room.elapsed<h.end-1e-8);}
function update(room,dt){if(room.status!=='playing')return;room.elapsed+=dt;updateSkills(room);updateHealing(room,dt);updateHordePhase(room);if(room.upgrade&&room.elapsed>=room.upgrade.end)finalizeUpgrade(room);maybeStartUpgrade(room);if(room.mode==='zombie'&&!room.upgrade&&(room.hordePhase||'normal')==='normal'&&(room.wave===0&&room.elapsed>=3||room.wave>0&&(room.elapsed>=room.nextWave||!room.actors.some(a=>a.zombie&&a.alive))))spawnZombieWave(room);updateHordePhase(room);const zone=room.zone;if(room.mode!=='zombie'&&room.elapsed>=zone.next&&zone.stage<6){zone.stage++;zone.fromR=zone.r;zone.toR=(room.mode==='duel'?205:440)*(1-zone.stage/6);zone.fromX=zone.x;zone.fromZ=zone.z;if(room.mode!=='duel'){const maxShift=Math.max(0,zone.r-zone.toR);const angle=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*maxShift;zone.targetX=clamp(zone.x+Math.cos(angle)*r,-room.mapSize/2+zone.toR,room.mapSize/2-zone.toR);zone.targetZ=clamp(zone.z+Math.sin(angle)*r,-room.mapSize/2+zone.toR,room.mapSize/2-zone.toR);}zone.shrinkStart=room.elapsed;zone.shrinkEnd=room.mode==='duel'?room.elapsed:room.elapsed+30;if(room.mode==='duel')zone.r=zone.toR;zone.next+=120;room.events.push({type:'zone',stage:zone.stage});if([2,3,4].includes(zone.stage)){let p=free(rand(-150,150),rand(-150,150),room);room.drops??=[];room.drops.push({x:p.x,z:p.z,landAt:room.elapsed+20,landed:false,announced:false});room.events.push({type:'airdrop',x:p.x,z:p.z})}}
if(zone.shrinkEnd>zone.shrinkStart){const t=clamp((room.elapsed-zone.shrinkStart)/(zone.shrinkEnd-zone.shrinkStart),0,1);zone.r=zone.fromR+(zone.toR-zone.fromR)*t;if(room.mode!=='duel'){zone.x=(zone.fromX??zone.x)+(((zone.targetX??zone.x)-(zone.fromX??zone.x))*t);zone.z=(zone.fromZ??zone.z)+(((zone.targetZ??zone.z)-(zone.fromZ??zone.z))*t);}}
for(const drop of room.drops||[]){if(!drop.landed&&!drop.announced&&drop.landAt-room.elapsed<=3){drop.announced=true;room.events.push({type:'airdropSoon',x:drop.x,z:drop.z});}if(!drop.landed&&room.elapsed>=drop.landAt){drop.landed=true;room.chests.push(makeChest('airdrop',drop.x,drop.z,rollAirdropChest(),{gift:true}))}}
for(const a of room.actors){if(!a.alive)continue;if(dashing(a))updateDash(room,a,dt);else if(a.zombie)zombieAI(room,a,dt);else if(a.bat)batAI(room,a,dt);else if(a.clone)cloneAI(room,a,dt);else if(a.bot)ai(room,a,dt);if(a.healUntil&&room.elapsed>=a.healUntil){a.hp=Math.min(a.maxHp||100,a.hp+40);a.healUntil=0}if(a.poisonUntil&&room.elapsed<a.poisonUntil&&room.elapsed>=a.poisonNext){a.poisonNext+=1;damage(room,a,a.poisonDamage||5,room.actors.find(p=>p.id===a.poisonOwner))}if(room.mode!=='zombie'&&dist(a,zone)>zone.r){a.zoneAcc=(a.zoneAcc||0)+dt;while(a.zoneAcc>=1){a.zoneAcc-=1;damage(room,a,20)}}else a.zoneAcc=0;if(a.alive&&a.reloadUntil&&room.elapsed>=a.reloadUntil){a.mag[a.gun]=weaponOf(a).mag;a.reloadUntil=0}}
if(room.mode==='zombie')room.actors=room.actors.filter(a=>!a.zombie||a.alive||room.elapsed-a.deadAt<20);
for(let i=room.bullets.length-1;i>=0;i--){let b=room.bullets[i],gone=false;const step=b.speed*dt,n=Math.max(1,Math.ceil(step/2));for(let k=0;k<n&&!gone;k++){b.x+=b.dx*step/n;b.z+=b.dz*step/n;if(wallHit(b.x,b.z,room)){gone=true;break}for(const a of room.actors){if(a.alive&&!phased(room,a)&&a.team!==b.team&&Math.hypot(a.x-b.x,a.z-b.z)<2.5){hit(room,b,a);gone=true;break}}}b.life-=dt;if(gone||b.life<=0)room.bullets.splice(i,1)}
updateHordePhase(room);updateRevives(room);settleDowned(room);const teams=new Set(room.actors.filter(a=>a.alive&&!a.clone&&!a.bat).map(a=>a.team));if((room.mode==='zombie'?!room.actors.some(a=>!a.bot&&a.alive):teams.size<=1)&&!room.ended){room.ended=true;room.status='ended';broadcast(room,state(room));broadcast(room,{type:'end',winner:[...teams][0]??-1})}}
function state(room){const actors=room.actors.map(a=>({id:a.id,team:a.team,name:a.name,bot:a.bot,character:a.character||null,clone:!!a.clone,bat:!!a.bat,anchor:a.anchor||null,anchorRemaining:a.anchor?Math.max(0,a.anchor.end-room.elapsed):0,teleportSeq:a.teleportSeq||0,phased:!!phased(room,a),dashing:dashing(a),fireSlowed:fireSlow(room,a)<1,skillRemaining:Math.max(0,(a.skillUntil||0)-room.elapsed),x:Math.round(a.x*10)/10,z:Math.round(a.z*10)/10,hp:Math.round(a.hp*10)/10,maxHp:a.maxHp||100,boss:!!a.boss,zombie:!!a.zombie,golden:!!a.golden,alive:a.alive,downed:!!a.downed,rescuer:a.rescuer||null,rescueTarget:a.rescue?.target||null,rescueRemaining:a.rescue?Math.max(0,a.rescue.end-room.elapsed):0,gun:a.gun,owned:a.owned,helmet:a.helmet,armor:a.armor,special:a.special,med:a.med,mag:a.mag[a.gun],aimX:a.aimX,aimZ:a.aimZ,aiming:a.aiming,heal:a.healUntil?Math.max(0,a.healUntil-room.elapsed):0,reload:a.reloadUntil?Math.max(0,a.reloadUntil-room.elapsed):0,reloadTotal:weaponOf(a).reload,revive:a.revive,buffs:a.buffs||{cd:0,damage:0,defense:0,hp:0}}));return {type:'state',elapsed:room.elapsed,actors,fires:room.fires,healingZones:room.healingZones,loot:room.loot,chests:(room.chests||[]).filter(c=>!c.opened).map(c=>({id:c.id,kind:c.kind,x:c.x,z:c.z,gift:!!c.gift,ownerName:c.ownerName||''})),bullets:room.bullets.map(b=>({id:b.id,x:b.x,z:b.z,dx:b.dx,dz:b.dz,speed:b.speed,life:b.life})),events:room.events,zone:room.zone,drop:(room.drops||[]).at(-1)||null,drops:room.drops||[],wave:room.wave||0,hordePhase:room.hordePhase||'normal',upgrade:room.upgrade?{wave:room.upgrade.wave,choices:room.upgrade.choices,end:Math.max(0,room.upgrade.end-room.elapsed),chosen:room.upgrade.chosen}:null,zombieCount:actors.filter(a=>a.zombie&&a.alive).length,score:room.actors.filter(a=>!a.bot).map(a=>({id:a.id,name:a.name,score:a.score||0})),remaining:actors.filter(a=>a.alive&&!a.clone&&!a.bat).length}}
const server=http.createServer((req,res)=>{let u;try{u=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400);return res.end()}const file=path.resolve(ROOT,'.'+(u==='/'?'/index.html':u));if(!file.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end()}fs.readFile(file,(e,b)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mp3':'audio/mpeg','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(b)})});const wss=new WebSocket.Server({server});
wss.on('connection',ws=>{let room=null,info=null;ws.isAlive=true;
ws.on('pong',()=>{ws.isAlive=true});
ws.on('message',raw=>{let m;try{m=JSON.parse(raw)}catch{return}if(!m||typeof m!=='object')return;
if(m.type==='resume'){
 const session=sessions.get(String(m.token||''));
 if(!session||session.expires<Date.now()||session.room.status==='ended'){
   send(ws,{type:'resume_failed',message:'原房间已失效，可以重新创建房间'});return;
 }
 room=session.room;info=session.info;
 if(session.ws&&session.ws!==ws){const old=session.ws;room.clients.delete(old);try{old.close(4001,'replaced')}catch{}}
 session.ws=ws;session.expires=Date.now()+GRACE_MS;room.clients.set(ws,info);
 if(!room.host)room.host=ws;
 send(ws,{type:'session',token:session.token});
 send(ws,{type:'room',code:room.code,mode:room.mode,difficulty:room.difficulty,host:room.host===ws});
 if(room.status==='lobby')broadcast(room,{type:'lobby',players:[...room.clients.values()].map(p=>p.name)});
 else if(room.status==='selecting')selection(room);
 else if(room.status==='playing'){
   send(ws,{type:'assigned',id:info.actorId,team:room.actors.find(a=>a.id===info.actorId)?.team??0});
   send(ws,{type:'start',mode:room.mode,difficulty:room.difficulty,map:room.mapSize,obstacles:room.obstacles,regions:room.regions||[]});
   send(ws,state(room));
 }
 return;
}
if(m.type==='create'||m.type==='join'){if(room)return;let code=m.type==='create'?String(Math.floor(rand(100000,999999))):String(m.code||'');if(m.type==='create'){while(rooms.has(code))code=String(Math.floor(rand(100000,999999)));room=makeRoom(code,['duel','zombie'].includes(m.mode)?m.mode:'squad',['easy','normal','hard'].includes(m.difficulty)?m.difficulty:'easy');rooms.set(code,room);room.host=ws}else{room=rooms.get(code);if(!room||room.status!=='lobby'||room.clients.size>=(room.mode==='duel'?2:4)){send(ws,{type:'error',message:'房间不存在、已开始或已满'});room=null;return}}info={name:String(m.name||'Player').slice(0,18),actorId:null,input:{}};
 const token=crypto.randomBytes(24).toString('hex');
 info.sessionToken=token;
 sessions.set(token,{token,room,info,ws,expires:Date.now()+GRACE_MS});
 room.clients.set(ws,info);send(ws,{type:'session',token});send(ws,{type:'room',code,mode:room.mode,difficulty:room.difficulty,host:room.host===ws});broadcast(room,{type:'lobby',players:[...room.clients.values()].map(p=>p.name)});return}if(!room||!info)return;if(m.type==='start'&&ws===room.host&&room.status==='lobby'){room.status='selecting';selection(room);return}if(room.status==='selecting'){if(m.type==='character'&&characters.includes(m.character)){info.character=m.character;info.ready=false;selection(room)}if(m.type==='ready'&&characters.includes(info.character)){info.ready=!!m.ready;selection(room);checkReady(room)}return}if(room.status!=='playing')return;const a=room.actors.find(p=>p.id===info.actorId);if(!a)return;if(m.type==='upgrade'){pickUpgrade(room,a,String(m.choice||''));return;}if(m.type==='cancel_revive'){cancelRevive(room,a);return;}if(m.type==='revive'){beginRevive(room,a,Number(m.target));return;}if(m.type==='open_chest'){openChest(room,a,Number(m.id));return;}if(!a.alive||a.rescue)return;if(m.type==='skill'){useSkill(room,a,m)}else if(m.type==='input'&&a.alive){let dx=clamp(Number(m.dx)||0,-1,1),dz=clamp(Number(m.dz)||0,-1,1),l=Math.hypot(dx,dz)||1;dx/=Math.max(1,l);dz/=Math.max(1,l);let ax=Number(m.ax),az=Number(m.az);if(!dashing(a)&&Number.isFinite(ax)&&Number.isFinite(az)&&Math.hypot(ax,az)>.2){let al=Math.hypot(ax,az);a.aimX=ax/al;a.aimZ=az/al}a.aiming=!!m.aiming;let speed=a.slowUntil>room.elapsed?(room.mode==='duel'?7.2:12):(room.mode==='duel'?9:15);if(a.healUntil>room.elapsed)speed*=.3;if(a.gun===2)speed*=.7;if(a.gun===3&&a.aiming)speed=0;speed*=fireSlow(room,a);if(dashing(a))speed=0;let nx=a.x+dx*speed/20,nz=a.z+dz*speed/20;if(!blocked(nx,a.z,room))a.x=nx;if(!blocked(a.x,nz,room))a.z=nz;if(m.fire&&[1,2].includes(a.gun))shoot(room,a)}else if(m.type==='release'&&a.alive&&[0,3,4,SHIELD].includes(a.gun)){if(!dashing(a)&&Number.isFinite(m.ax)&&Number.isFinite(m.az)){const l=Math.hypot(m.ax,m.az);if(l>.2&&Number.isFinite(l)){a.aimX=m.ax/l;a.aimZ=m.az/l;}}shoot(room,a)}else if(m.type==='pickup')pickup(room,a,Number(m.id));else if(m.type==='equip'&&a.alive&&a.character!=='shield'){const gun=Number(m.gun);if(Number.isInteger(gun)&&gun>=0&&gun<guns.length&&a.owned[gun]){a.gun=gun;a.aiming=false}}else if(m.type==='reload'&&a.alive&&a.character!=='shield'&&!a.reloadUntil)a.reloadUntil=room.elapsed+guns[a.gun].reload;else if(m.type==='heal'&&a.alive&&a.med>0&&!a.healUntil){a.med--;a.healUntil=room.elapsed+3}else if(m.type==='drop'&&a.alive){const slot=String(m.slot);let lv=0;if(slot==='helmet'){lv=a.helmet;a.helmet=0}else if(slot==='armor'){lv=a.armor;a.armor=0}else if(slot==='special'){lv=a.special;a.special=0}else if(slot==='gun'&&a.gun!==0&&a.character!=='shield'){lv=a.gun;a.owned[lv]=false;a.gun=0}if(lv)room.loot.push(item(slot,a.x+4,a.z+4,lv))}});ws.on('close',(code)=>{
 if(!room)return;
 // A replaced socket must never remove its successor from the room.
 if(room.clients.get(ws)!==info)return;
 room.clients.delete(ws);
 const actor=room.actors.find(a=>a.id===info.actorId);if(actor)cancelRevive(room,actor);
 const session=sessions.get(info.sessionToken);
 if(session&&session.ws===ws){session.ws=null;session.expires=Date.now()+GRACE_MS}
 if(room.host===ws)room.host=room.clients.keys().next().value||null;
 if(room.status==='lobby')broadcast(room,{type:'lobby',players:[...room.clients.values()].map(p=>p.name)});
 if(room.status==='selecting'){selection(room);checkReady(room)}
 console.log('[ws-close]',room.code,'code',code,'active',room.clients.size);
 });ws.on('error',err=>console.warn('[ws-error]',err.message));});
// Keep idle WebSockets alive through proxies; terminate only after a missed pong.
setInterval(()=>{for(const ws of wss.clients){if(ws.isAlive===false){ws.terminate();continue}ws.isAlive=false;try{ws.ping()}catch{ws.terminate()}}},25000);

let netTick=0;setInterval(()=>{netTick++;for(const r of rooms.values()){update(r,1/TICK);if(netTick%2===0){if(r.status==='playing'&&r.clients.size)broadcast(r,state(r));r.events=[];}}},1000/TICK);setInterval(()=>{
 const now=Date.now();
 for(const [token,s] of sessions)if(!s.ws&&s.expires<now)sessions.delete(token);
 for(const [code,r] of rooms){
   const hasSession=[...sessions.values()].some(s=>s.room===r);
   if(now-r.created>3*60*60*1000||(!r.clients.size&&!hasSession&&now-r.created>60000)){
     rooms.delete(code);for(const [token,s] of sessions)if(s.room===r)sessions.delete(token);
   }
 }
},15000);server.listen(PORT,'0.0.0.0',()=>console.log(`Pixel Survival V1.3.3 listening on ${PORT}`));
