// The camera never selects an opponent, clone, or downed player as a spectator target.
export function spectatorTargets(actors,myId){
 const me=actors.find(a=>a.id===myId);
 return me?.downed?actors.filter(a=>a.id!==myId&&a.team===me.team&&a.alive&&!a.bot&&!a.clone):[];
}
export function chooseFocus(actors,myId,preferred){
 const me=actors.find(a=>a.id===myId);
 if(!me||me.alive)return me;
 if(me.downed){const targets=spectatorTargets(actors,myId);return targets.find(a=>a.id===preferred)||targets[0]||me;}
 return actors.find(a=>a.team===me.team&&a.alive)||me;
}
export function downedMarkers(actors,team){return actors.filter(a=>a.team===team&&a.downed&&!a.bot&&!a.clone);}
