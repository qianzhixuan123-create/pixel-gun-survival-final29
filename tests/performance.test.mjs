import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaults,normalizeSettings,pixelRatio,adaptiveScale,FrameGate,Pool,pushSample,sampleAt} from '../public/performance.js';
test('requested defaults, validation and persistence round trip',()=>{
 assert.deepEqual(normalizeSettings(),{fps:90,quality:'high',resolution:80,dynamic:true,effects:true,lod:true});
 assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(defaults))),defaults);
 assert.deepEqual(normalizeSettings({fps:'120',quality:'low',resolution:'73',dynamic:false,effects:false,lod:false}),{fps:120,quality:'low',resolution:75,dynamic:false,effects:false,lod:false});
 assert.equal(normalizeSettings({fps:999,quality:'constructor',resolution:12}).fps,90);
 assert.equal(normalizeSettings({quality:'constructor'}).quality,'high');
 assert.equal(normalizeSettings({resolution:12}).resolution,50);
 assert.equal(normalizeSettings({resolution:200}).resolution,100);
});
test('pixel ratio and adaptive scale are bounded by user preference',()=>{
 assert.equal(pixelRatio(defaults,3),.8);assert.equal(pixelRatio({...defaults,quality:'ultra'},3),1.2000000000000002);
 let scale=.8;for(let i=0;i<20;i++)scale=adaptiveScale(scale,defaults,40,90);assert.equal(scale,.5);
 for(let i=0;i<20;i++)scale=adaptiveScale(scale,defaults,90,90);assert.equal(scale,.8);
 assert.equal(adaptiveScale(.8,defaults,60,60),.8);
 assert.equal(adaptiveScale(.55,{...defaults,dynamic:false},20,90),.8);
});
function frames(refresh,target){const gate=new FrameGate();let n=0;for(let i=0;i<refresh*10;i++)if(gate.due(i*1000/refresh,target))n++;return n/10;}
test('frame cap works across refresh rates and unlimited mode',()=>{
 for(const refresh of [60,90,120,144])for(const target of [30,60,90,120,0])assert.ok(Math.abs(frames(refresh,target)-Math.min(refresh,target||refresh))<1,`${refresh}/${target}: ${frames(refresh,target)}`);
});
test('pool reuses objects, resets, bounds allocation and disposes overflow',()=>{
 let made=0,reset=0,disposed=0;const p=new Pool(()=>({id:++made}),v=>{reset++;v.active=false;},()=>disposed++,2);
 const a=p.acquire(),b=p.acquire(),c=p.acquire();a.active=true;p.release(a);p.release(b);assert.equal(p.release(c),false);assert.equal(disposed,1);assert.equal(reset,3);assert.equal(p.acquire(),b);assert.equal(p.acquire(),a);assert.equal(a.active,false);assert.equal(made,3);p.release(a);p.clear();assert.equal(disposed,2);assert.equal(p.free.length,0);
});
test('interpolation uses bracketing snapshots and shortest angle, never extrapolates',()=>{
 const q=[];pushSample(q,100,0,0,Math.PI-.1);pushSample(q,200,10,4,-Math.PI+.1);
 const v=sampleAt(q,150);assert.equal(v.x,5);assert.equal(v.z,2);assert.ok(Math.abs(v.angle-Math.PI)<1e-8);assert.equal(sampleAt(q,0).x,0);assert.equal(sampleAt(q,500).x,10);assert.equal(sampleAt([],500),null);
});
test('snapshot buffer is bounded and resets on teleport or out-of-order samples',()=>{
 const q=[];for(let i=0;i<30;i++)pushSample(q,i*66,i,0);assert.equal(q.length,8);pushSample(q,3000,200,0);assert.equal(q.length,1);pushSample(q,2999,201,0);assert.equal(q.length,1);assert.equal(q[0].x,201);
});
test('settings UI exposes every control and client uses performance module',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),js=readFileSync(new URL('../public/game.js',import.meta.url),'utf8');
 for(const k of Object.keys(defaults))assert.ok(html.includes(`id="perf-${k}"`));
 for(const id of ['perfPanel','perfLobby','perfGame','perfClose','perfReset','perf-actual','perf-resolution-value'])assert.ok(html.includes(`id="${id}"`));
 assert.match(js,/performance\.js\?v=131/);assert.match(js,/new THREE\.InstancedMesh/);assert.match(js,/setFromProjectionMatrix/);assert.match(js,/sampleAt\(p\.samples/);assert.match(js,/frameGate\.due/);assert.match(js,/firePool\.release/);
});
