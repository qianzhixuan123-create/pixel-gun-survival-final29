import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spectatorTargets,chooseFocus,downedMarkers} from '../public/spectator.js';
const a=(id,team,extra={})=>({id,team,alive:true,downed:false,bot:false,clone:false,...extra});
test('spectating selects only living real teammates, switches and returns on revival',()=>{
 const me=a(1,0,{alive:false,downed:true}), p=a(2,0), q=a(3,0), bot=a(4,0,{bot:true}), clone=a(5,0,{clone:true}), enemy=a(6,1), down=a(7,0,{alive:false,downed:true});
 const actors=[me,p,q,bot,clone,enemy,down];
 assert.deepEqual(spectatorTargets(actors,1).map(x=>x.id),[2,3]);
 assert.equal(chooseFocus(actors,1,null),p);assert.equal(chooseFocus(actors,1,3),q);assert.equal(chooseFocus(actors,1,6),p);
 q.alive=false;q.downed=true;assert.equal(chooseFocus(actors,1,3),p);p.alive=false;assert.equal(chooseFocus(actors,1,3),me);
 me.alive=true;me.downed=false;assert.equal(chooseFocus(actors,1,3),me);assert.deepEqual(spectatorTargets(actors,1),[]);
});
test('map marks downed real teammates at original coordinates only; clears after revival',()=>{
 const me=a(1,0), p=a(2,0,{alive:false,downed:true,x:75,z:-120}), e=a(3,1,{alive:false,downed:true}), bot=a(4,0,{bot:true,alive:false,downed:true}), clone=a(5,0,{clone:true,alive:false,downed:true});
 const actors=[me,p,e,bot,clone];assert.deepEqual(downedMarkers(actors,0),[p]);assert.equal(downedMarkers(actors,0)[0].z,-120);p.alive=true;p.downed=false;assert.deepEqual(downedMarkers(actors,0),[]);
});
