import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/game.js',import.meta.url),'utf8');
const start=source.indexOf('const defaultLayout=');
const end=source.indexOf('function blockedRay(',start);
function harness(saved,w=844,h=390){
 assert.ok(start>=0&&end>start,'HUD input initialization exists');
 const nodes=new Map(),winEvents=new Map();
 function node(id){if(!nodes.has(id))nodes.set(id,{style:{},events:new Map(),addEventListener(type,fn){this.events.set(type,fn)},querySelector(){return this.nub??={style:{}}}});return nodes.get(id)}
 const ctx=vm.createContext({$:node,innerWidth:w,innerHeight:h,localStorage:{getItem(){return saved},setItem(){}},window:{addEventListener(type,fn){winEvents.set(type,fn)}},layout:null});
 vm.runInContext(source.slice(start,end)+'\nglobalThis.controls={positionUI,slots,nub,handle};',ctx);
 return {ctx,nodes,winEvents};
}
test('HUD initialization executes and restores touch, keyboard, resize and layout controls',()=>{
 const {nodes,winEvents,ctx}=harness('{}');
 assert.equal(nodes.get('move').style.left,109.72+'px');
 assert.equal(nodes.get('aim').style.left,717.4+'px');
 for(const id of ['move','aim','skill'])for(const ev of ['pointerdown','pointermove','pointerup','pointercancel'])assert.ok(nodes.get(id).events.has(ev),`${id} ${ev}`);
 assert.ok(winEvents.has('keydown')&&winEvents.has('keyup')&&winEvents.has('resize'));
 assert.equal(typeof nodes.get('edit').onclick,'function');
 assert.equal(typeof ctx.controls.positionUI,'function');
});
test('invalid saved positions fall back; valid saved positions stay within viewport on resize',()=>{
 const {nodes,ctx}=harness('{"move":[-1,2],"aim":[1,1],"skill":null}');
 assert.equal(nodes.get('move').style.left,109.72+'px');
 assert.equal(nodes.get('aim').style.left,'782px');
 assert.equal(nodes.get('aim').style.top,'328px');
 ctx.innerWidth=390;ctx.innerHeight=844;ctx.controls.positionUI();
 assert.equal(nodes.get('aim').style.left,'328px');
 assert.equal(nodes.get('aim').style.top,'782px');
});
test('render loop starts after control setup and resize; map drawing is independent',()=>{
 assert.ok(source.indexOf('function positionUI()')<source.indexOf('function resize()'));
 assert.match(source,/resize\(\);requestAnimationFrame\(frame\)/);
 assert.match(source,/function drawMap\(\)/);
});

test('all seven skill gestures release once or cancel without sending; pointer loss cancels',()=>{
 const nodes=new Map(),messages=[];const roleNames=['flame','phase','shield','twin','sage','vampire','blackhole'];
 function node(id){if(!nodes.has(id)){const cls=new Set();nodes.set(id,{hidden:id==='cancelSkill'||id==='skillHint',style:{},events:new Map(),classList:{add(x){cls.add(x)},remove(x){cls.delete(x)},contains(x){return cls.has(x)},toggle(x,on){if(on)cls.add(x);else cls.delete(x)}},addEventListener(type,fn){this.events.set(type,fn)},setPointerCapture(){},getBoundingClientRect(){return id==='cancelSkill'?{left:630,top:80,width:74,height:74}:{left:505,top:170,width:76,height:76};}});}return nodes.get(id)}
 const ctx=vm.createContext({$:node,innerWidth:844,innerHeight:390,skillAim:null,skillPending:0,skillPointer:null,groundPointer:null,skillOrigin:null,skillDragged:false,editing:false,held:false,aiming:false,sniperHold:0,aim:{x:1,y:0},skillPreview:{visible:false},dashPreview:{visible:false},skillAvailable:()=>true,skillRole:()=>ctx.role,updateSkill(){},send:o=>messages.push(o),performance:{now:()=>1000},flameOffset:(x,y)=>({x,z:y}),window:{addEventListener(){}}});
 const functions=source.slice(source.indexOf('function cancelSkill()'),source.indexOf('function setGroundSkill'))+source.slice(source.indexOf('function confirmSkill()'),source.indexOf('const anchorMeshes'));
 const handlers=source.slice(source.indexOf("const skillButton=$('skill');"),source.indexOf("$('edit').onclick"));
 vm.runInContext(functions+handlers,ctx);
 const emit=(type,x,y,id=1)=>node('skill').events.get(type)({pointerId:id,button:0,clientX:x,clientY:y,preventDefault(){}});
 for(const role of roleNames){ctx.role=role;ctx.skillPending=0;const n=messages.length;emit('pointerdown',543,208);assert.equal(messages.length,n);assert.equal(node('cancelSkill').hidden,false);emit('pointermove',667,117);emit('pointerup',667,117);assert.equal(messages.length,n);assert.equal(ctx.skillPending,0);assert.equal(node('cancelSkill').hidden,true);emit('pointerdown',543,208);emit('pointermove',560,208);emit('pointerup',560,208);assert.equal(messages.length,n+1);assert.equal(messages.at(-1).type,'skill');assert.equal(node('cancelSkill').hidden,true);ctx.skillPending=0;emit('pointerdown',543,208);emit('pointercancel',543,208);emit('pointerup',543,208);assert.equal(messages.length,n+1);assert.equal(node('cancelSkill').hidden,true);}
});
